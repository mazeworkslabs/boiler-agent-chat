"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { useWebSocket, type WSMessage } from "@/hooks/use-websocket";
import { ChatInput, type AttachedFile, type AgentMode } from "./chat-input";
import { MessageBubble, type Message } from "./message-bubble";
import { ToolCallIndicator } from "./tool-call-indicator";
import { FileDownload } from "./file-download";
import { ImageLightbox } from "./image-lightbox";
import { v4 as uuidv4 } from "uuid";

interface ToolCall {
  id: string;
  name: string;
  status: "running" | "success" | "error";
  summary?: string;
}

interface GeneratedFile {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

interface ChatPanelProps {
  sessionId: string | null;
  onSessionCreated: (id: string) => void;
  onArtifact?: (artifact: { id: string; title: string; type: string; content: string }) => void;
  artifactCount?: number;
  artifactPanelOpen?: boolean;
  onToggleArtifactPanel?: () => void;
}

export function ChatPanel({ sessionId, onSessionCreated, onArtifact, artifactCount, artifactPanelOpen, onToggleArtifactPanel }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingContent, setStreamingContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [generatedFiles, setGeneratedFiles] = useState<GeneratedFile[]>([]);
  const [activeAgent, setActiveAgent] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingMessageRef = useRef<{ content: string; provider: string; model: string; agentMode?: AgentMode } | null>(null);
  const streamingRef = useRef("");
  const sessionIdRef = useRef<string | null>(sessionId);
  // Stable refs for callbacks — avoids re-creating onMessage
  const onSessionCreatedRef = useRef(onSessionCreated);
  onSessionCreatedRef.current = onSessionCreated;
  const onArtifactRef = useRef(onArtifact);
  onArtifactRef.current = onArtifact;

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // Reset when user explicitly switches to a different session
  const prevSessionIdRef = useRef<string | null>(sessionId);
  useEffect(() => {
    const prev = prevSessionIdRef.current;
    prevSessionIdRef.current = sessionId;
    // Only reset if the sessionId actually changed to a different value
    // and it's not the initial mount (prev was already null)
    if (prev !== null && prev !== sessionId) {
      setMessages([]);
      setStreamingContent("");
      streamingRef.current = "";
      setIsStreaming(false);
      setIsThinking(false);
      setToolCalls([]);
      setGeneratedFiles([]);
    }
  }, [sessionId]);

  // sendRef so onMessage can call send without circular deps
  const sendRef = useRef<(msg: WSMessage) => void>(() => {});

  const onMessage = useCallback((msg: WSMessage) => {
    switch (msg.type) {
      case "session_created": {
        const newSessionId = msg.sessionId as string;
        sessionIdRef.current = newSessionId;
        onSessionCreatedRef.current(newSessionId);
        const pending = pendingMessageRef.current;
        if (pending) {
          pendingMessageRef.current = null;
          sendRef.current({
            type: "chat",
            sessionId: newSessionId,
            content: pending.content,
            provider: pending.provider,
            model: pending.model,
            ...(pending.agentMode && pending.agentMode !== "auto" ? { agentMode: pending.agentMode } : {}),
          });
        }
        break;
      }
      case "history":
        setMessages(
          (msg.messages as Array<{ id: string; role: string; content: string }>)
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => ({
              id: m.id,
              role: m.role as "user" | "assistant",
              content: m.content,
            }))
        );
        break;
      case "thinking":
        setIsThinking(true);
        setIsStreaming(true);
        break;
      case "text_delta": {
        setIsThinking(false);
        setIsStreaming(true);
        const delta = msg.content as string;
        streamingRef.current += delta;
        setStreamingContent(streamingRef.current);
        break;
      }
      case "tool_use": {
        // Flush any streaming text BEFORE the tool call so it appears above
        const preToolText = streamingRef.current;
        if (preToolText) {
          streamingRef.current = "";
          setStreamingContent("");
          setMessages((prev) => [
            ...prev,
            { id: uuidv4(), role: "assistant" as const, content: preToolText },
          ]);
        }
        setIsThinking(false);
        setToolCalls((prev) => [
          ...prev,
          { id: msg.toolId as string, name: msg.toolName as string, status: "running" },
        ]);
        break;
      }
      case "tool_result":
        setToolCalls((prev) =>
          prev.map((tc) =>
            tc.id === msg.toolId
              ? { ...tc, status: (msg.success ? "success" : "error") as "success" | "error", summary: msg.summary as string }
              : tc
          )
        );
        break;
      case "files":
        if (msg.files) {
          setGeneratedFiles((prev) => [...prev, ...(msg.files as GeneratedFile[])]);
        }
        break;
      case "agent_status": {
        // Flush streaming text from previous agent
        const preAgentText = streamingRef.current;
        if (preAgentText) {
          streamingRef.current = "";
          setStreamingContent("");
          setMessages((prev) => [
            ...prev,
            { id: uuidv4(), role: "assistant" as const, content: preAgentText },
          ]);
        }
        // Clear previous agent's tool calls
        setToolCalls([]);
        setActiveAgent(msg.content as string);
        break;
      }
      case "artifact":
        onArtifactRef.current?.({
          id: msg.id as string,
          title: msg.title as string,
          type: msg.artifactType as string,
          content: msg.content as string,
        });
        break;
      case "done": {
        const finalContent = streamingRef.current;
        if (finalContent) {
          setMessages((prev) => [
            ...prev,
            { id: uuidv4(), role: "assistant" as const, content: finalContent },
          ]);
        }
        streamingRef.current = "";
        setStreamingContent("");
        setIsStreaming(false);
        setIsThinking(false);
        setToolCalls([]);
        setActiveAgent(null);
        // Don't clear generatedFiles — they stay visible for download
        break;
      }
      case "error":
        streamingRef.current = "";
        setStreamingContent("");
        setIsStreaming(false);
        setIsThinking(false);
        break;
    }
  }, []); // No dependencies — fully stable

  const { connect, send, connected } = useWebSocket({ onMessage });

  // Keep sendRef in sync
  sendRef.current = send;

  useEffect(() => {
    connect();
  }, [connect]);

  useEffect(() => {
    if (connected && sessionId) {
      send({ type: "subscribe", sessionId });
    }
  }, [connected, sessionId, send]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streamingContent, toolCalls, activeAgent, generatedFiles]);

  const handleSend = (content: string, provider: string, model: string, files?: AttachedFile[], agentMode?: AgentMode) => {
    const displayContent = files && files.length > 0
      ? `${content}\n\n${files.map((f) => `[${f.filename}]`).join(" ")}`
      : content;
    setMessages((prev) => [...prev, { id: uuidv4(), role: "user", content: displayContent }]);

    const currentSessionId = sessionIdRef.current;
    if (!currentSessionId) {
      pendingMessageRef.current = { content, provider, model, agentMode };
      send({ type: "new_session" });
      return;
    }

    send({
      type: "chat",
      sessionId: currentSessionId,
      content,
      provider,
      model,
      ...(files && files.length > 0 ? { attachments: files } : {}),
      ...(agentMode && agentMode !== "auto" ? { agentMode } : {}),
    });
  };

  return (
    <div className="flex h-full flex-col">
      {/* Toggle artifact panel button */}
      {artifactCount != null && artifactCount > 0 && !artifactPanelOpen && onToggleArtifactPanel && (
        <div className="flex justify-end border-b border-border px-4 py-1.5">
          <button
            onClick={onToggleArtifactPanel}
            className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
          >
            Visa artifacts ({artifactCount})
          </button>
        </div>
      )}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-3xl space-y-4">
          {messages.length === 0 && !isStreaming && (
            <div className="flex h-full items-center justify-center pt-32">
              <div className="text-center">
                <h2 className="text-xl font-semibold text-foreground">
                  Business Falkenberg AI
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Hur kan jag hjälpa dig idag?
                </p>
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}

          {activeAgent && (
            <div className="flex justify-start">
              <div className="inline-flex items-center gap-2 rounded-lg bg-primary/5 border border-primary/20 px-3 py-2 text-sm text-foreground">
                <svg className="h-3.5 w-3.5 animate-spin text-primary shrink-0" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={2} className="opacity-25" />
                  <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
                </svg>
                <span>{activeAgent}</span>
              </div>
            </div>
          )}

          {toolCalls.map((tc) => (
            <ToolCallIndicator key={tc.id} toolName={tc.name} status={tc.status} summary={tc.summary} />
          ))}

          {generatedFiles.length > 0 && (
            <FileDownload
              files={generatedFiles}
              onImageClick={(idx) => setLightboxIndex(idx)}
            />
          )}

          {isThinking && (
            <div className="flex justify-start">
              <div className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">
                <span className="animate-pulse">Tänker...</span>
              </div>
            </div>
          )}

          {streamingContent && (
            <MessageBubble
              message={{ id: "streaming", role: "assistant", content: streamingContent }}
            />
          )}
        </div>
      </div>

      <ChatInput onSend={handleSend} disabled={isStreaming} />

      {/* Image lightbox */}
      {lightboxIndex !== null && (() => {
        const imageFiles = generatedFiles
          .filter((f) => f.mimeType.startsWith("image/"))
          .reverse(); // newest first
        return imageFiles.length > 0 ? (
          <ImageLightbox
            images={imageFiles}
            currentIndex={lightboxIndex}
            onClose={() => setLightboxIndex(null)}
            onNavigate={setLightboxIndex}
          />
        ) : null;
      })()}
    </div>
  );
}
