"use client";

import { useRef, useEffect, useState, useCallback, useEffectEvent } from "react";
import { useWebSocket, type WSMessage } from "@/hooks/use-websocket";
import { ChatInput, type AttachedFile, type AgentMode } from "./chat-input";
import { MessageBubble } from "./message-bubble";
import { ToolCallIndicator } from "./tool-call-indicator";
import { FileDownload } from "./file-download";
import { ImageLightbox } from "./image-lightbox";
import { SessionContextPanel } from "./session-context-panel";
import { v4 as uuidv4 } from "uuid";

interface GeneratedFile {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt?: string;
}

interface SessionNamedOutput {
  key: string;
  type: "artifact" | "file" | "text" | "data" | "summary";
  label: string;
  value: string;
  refId?: string;
  source: string;
  createdAt: string;
}

interface SessionWorkingFact {
  id: string;
  text: string;
  source: string;
  createdAt: string;
}

interface SessionDelegateResult {
  agent: string;
  summary: string;
  namedOutputs: SessionNamedOutput[];
  facts: SessionWorkingFact[];
  createdAt: string;
}

interface TimelineBaseEvent {
  id: string;
  createdAt: string;
  agent?: string;
}

interface TimelineThinkingEvent extends TimelineBaseEvent {
  type: "thinking";
}

interface TimelineStatusEvent extends TimelineBaseEvent {
  type: "status";
  content: string;
  tone: "info" | "error";
}

interface TimelineAgentStatusEvent extends TimelineBaseEvent {
  type: "agent_status";
  content: string;
  status?: "running" | "success" | "error";
}

interface TimelineAssistantTextEvent extends TimelineBaseEvent {
  type: "assistant_text";
  content: string;
}

interface TimelineToolCallEvent extends TimelineBaseEvent {
  type: "tool_call";
  toolId: string;
  toolName: string;
  status: "running" | "success" | "error";
  summary?: string;
  namedOutputs?: SessionNamedOutput[];
  facts?: SessionWorkingFact[];
  resultKind?: "tool" | "delegate";
}

interface TimelineArtifactEvent extends TimelineBaseEvent {
  type: "artifact";
  artifact: {
    id: string;
    title: string;
    type: string;
  };
}

interface TimelineFilesEvent extends TimelineBaseEvent {
  type: "files";
  files: GeneratedFile[];
}

type TimelineEvent =
  | TimelineThinkingEvent
  | TimelineStatusEvent
  | TimelineAgentStatusEvent
  | TimelineAssistantTextEvent
  | TimelineToolCallEvent
  | TimelineArtifactEvent
  | TimelineFilesEvent;

interface TimelineTurn {
  id: string;
  userMessageId?: string;
  userMessage: string;
  createdAt: string;
  events: TimelineEvent[];
}

interface SessionStateSnapshot {
  version: number;
  attachments: Array<{ id: string }>;
  artifacts: Array<{ id: string; title: string; type: string; createdAt?: string }>;
  generatedFiles: GeneratedFile[];
  namedOutputs: SessionNamedOutput[];
  workingFacts: SessionWorkingFact[];
  recentDelegateResults: SessionDelegateResult[];
  timelineTurns: TimelineTurn[];
}

interface ArtifactSnapshot {
  id: string;
  title: string;
  type: string;
  content: string;
}

interface EditingArtifact {
  id: string;
  title: string;
  type: string;
  content: string;
}

interface HistoryMessage {
  id: string;
  role: string;
  content: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: string;
}

interface ChatPanelProps {
  sessionId: string | null;
  onSessionCreated: (id: string) => void;
  onArtifact?: (artifact: { id: string; title: string; type: string; content: string }) => void;
  onReplaceArtifacts?: (artifacts: ArtifactSnapshot[]) => void;
  artifactCount?: number;
  artifactPanelOpen?: boolean;
  onToggleArtifactPanel?: () => void;
  editingArtifact?: EditingArtifact | null;
  onClearEditingArtifact?: () => void;
}

function createEmptySessionSnapshot(): SessionStateSnapshot {
  return {
    version: 2,
    attachments: [],
    artifacts: [],
    generatedFiles: [],
    namedOutputs: [],
    workingFacts: [],
    recentDelegateResults: [],
    timelineTurns: [],
  };
}

function mergeGeneratedFiles(
  currentFiles: GeneratedFile[],
  incomingFiles: GeneratedFile[]
): GeneratedFile[] {
  const nextFiles = [...currentFiles];
  const indexById = new Map(nextFiles.map((file, index) => [file.id, index]));

  for (const file of incomingFiles) {
    const existingIndex = indexById.get(file.id);
    if (existingIndex == null) {
      indexById.set(file.id, nextFiles.length);
      nextFiles.push(file);
      continue;
    }

    nextFiles[existingIndex] = { ...nextFiles[existingIndex], ...file };
  }

  return nextFiles;
}

function normalizeFactTexts(facts: unknown): string[] {
  if (!Array.isArray(facts)) return [];

  return facts
    .map((fact) => {
      if (typeof fact === "string") return fact;
      if (fact && typeof fact === "object" && "text" in fact && typeof fact.text === "string") {
        return fact.text;
      }
      return null;
    })
    .filter((fact): fact is string => Boolean(fact));
}

function getAgentStatusState(content: string): "running" | "success" | "error" {
  if (/\b(klar|fardig|färdig|slutford|slutförd|done|completed)\b/i.test(content)) {
    return "success";
  }

  if (/\b(fel|misslyckad|misslyckades|error|failed)\b/i.test(content)) {
    return "error";
  }

  return "running";
}

function mergeNamedOutputs(
  currentOutputs: SessionNamedOutput[],
  incomingOutputs: SessionNamedOutput[]
): SessionNamedOutput[] {
  const next = [...currentOutputs];
  const indexByKey = new Map(next.map((output, index) => [output.key, index]));

  for (const output of incomingOutputs) {
    const existingIndex = indexByKey.get(output.key);
    if (existingIndex == null) {
      indexByKey.set(output.key, next.length);
      next.push(output);
      continue;
    }

    next[existingIndex] = { ...next[existingIndex], ...output };
  }

  return next.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function mergeWorkingFacts(
  currentFacts: SessionWorkingFact[],
  incomingFacts: SessionWorkingFact[]
): SessionWorkingFact[] {
  const next = [...currentFacts];
  const indexById = new Map(next.map((fact, index) => [fact.id, index]));

  for (const fact of incomingFacts) {
    const existingIndex = indexById.get(fact.id);
    if (existingIndex == null) {
      indexById.set(fact.id, next.length);
      next.push(fact);
      continue;
    }

    next[existingIndex] = { ...next[existingIndex], ...fact };
  }

  return next.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-20);
}

function ensureTurn(
  turns: TimelineTurn[],
  turnId: string,
  params: {
    createdAt: string;
    userMessage?: string;
    userMessageId?: string;
  }
): TimelineTurn[] {
  const existingIndex = turns.findIndex((turn) => turn.id === turnId);
  if (existingIndex === -1) {
    return [
      ...turns,
      {
        id: turnId,
        userMessageId: params.userMessageId,
        userMessage: params.userMessage || "",
        createdAt: params.createdAt,
        events: [],
      },
    ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  const nextTurns = [...turns];
  nextTurns[existingIndex] = {
    ...nextTurns[existingIndex],
    userMessage: params.userMessage ?? nextTurns[existingIndex].userMessage,
    userMessageId: params.userMessageId ?? nextTurns[existingIndex].userMessageId,
  };
  return nextTurns;
}

function appendEventToTurn(
  turns: TimelineTurn[],
  turnId: string,
  event: TimelineEvent
): TimelineTurn[] {
  const nextTurns = ensureTurn(turns, turnId, { createdAt: event.createdAt });
  return nextTurns.map((turn) => {
    if (turn.id !== turnId) return turn;

    if (event.type === "assistant_text") {
      const lastEvent = turn.events[turn.events.length - 1];
      if (lastEvent?.type === "assistant_text") {
        return {
          ...turn,
          events: [
            ...turn.events.slice(0, -1),
            { ...lastEvent, content: lastEvent.content + event.content },
          ],
        };
      }
    }

    return {
      ...turn,
      events: [...turn.events, event].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    };
  });
}

function updateToolCallInTurns(
  turns: TimelineTurn[],
  turnId: string,
  params: {
    toolId: string;
    toolName: string;
    status: "running" | "success" | "error";
    createdAt: string;
    agent?: string;
    summary?: string;
    namedOutputs?: SessionNamedOutput[];
    facts?: SessionWorkingFact[];
    resultKind?: "tool" | "delegate";
  }
): TimelineTurn[] {
  const nextTurns = ensureTurn(turns, turnId, { createdAt: params.createdAt });

  return nextTurns.map((turn) => {
    if (turn.id !== turnId) return turn;

    const eventIndex = turn.events.findIndex(
      (event) => event.type === "tool_call" && event.toolId === params.toolId
    );

    if (eventIndex === -1) {
      return {
        ...turn,
        events: [
          ...turn.events,
          {
            id: params.toolId,
            type: "tool_call",
            createdAt: params.createdAt,
            toolId: params.toolId,
            toolName: params.toolName,
            status: params.status,
            agent: params.agent,
            summary: params.summary,
            namedOutputs: params.namedOutputs,
            facts: params.facts,
            resultKind: params.resultKind,
          } satisfies TimelineToolCallEvent,
        ].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      };
    }

    const nextEvents = [...turn.events];
    const existingEvent = nextEvents[eventIndex] as TimelineToolCallEvent;
    nextEvents[eventIndex] = {
      ...existingEvent,
      status: params.status,
      agent: params.agent ?? existingEvent.agent,
      summary: params.summary ?? existingEvent.summary,
      namedOutputs: params.namedOutputs ?? existingEvent.namedOutputs,
      facts: params.facts ?? existingEvent.facts,
      resultKind: params.resultKind ?? existingEvent.resultKind,
    };

    return { ...turn, events: nextEvents };
  });
}

function buildFallbackTimelineFromHistory(messages: HistoryMessage[]): TimelineTurn[] {
  const turns: TimelineTurn[] = [];
  const assistantSegmentsByTurn = new Set<string>();
  let activeTurnId: string | null = null;

  for (const message of messages) {
    const metadata = (message.metadata || {}) as Record<string, unknown>;
    const createdAt = typeof message.createdAt === "string" ? message.createdAt : new Date(0).toISOString();

    if (message.role === "user") {
      const turnId = typeof metadata.turnId === "string" ? metadata.turnId : message.id;
      activeTurnId = turnId;
      const ensuredTurns = ensureTurn(turns, turnId, {
        createdAt,
        userMessage: message.content || "",
        userMessageId: message.id,
      });
      turns.splice(0, turns.length, ...ensuredTurns);
      continue;
    }

    const turnId = typeof metadata.turnId === "string" ? metadata.turnId : activeTurnId;
    if (!turnId) continue;

    if (message.role === "thinking") {
      turns.splice(
        0,
        turns.length,
        ...appendEventToTurn(turns, turnId, {
          id: `thinking:${message.id}`,
          type: "thinking",
          createdAt,
        })
      );
      continue;
    }

    if (message.role === "agent_status") {
      turns.splice(
        0,
        turns.length,
        ...appendEventToTurn(turns, turnId, {
          id: `agent_status:${message.id}`,
          type: "agent_status",
          createdAt,
          agent: typeof metadata.agent === "string" ? metadata.agent : undefined,
          content: message.content || "",
          status: getAgentStatusState(message.content || ""),
        })
      );
      continue;
    }

    if (message.role === "assistant_segment") {
      assistantSegmentsByTurn.add(turnId);
      turns.splice(
        0,
        turns.length,
        ...appendEventToTurn(turns, turnId, {
          id: message.id,
          type: "assistant_text",
          createdAt,
          content: message.content || "",
        })
      );
      continue;
    }

    if (message.role === "assistant") {
      if (assistantSegmentsByTurn.has(turnId)) continue;
      turns.splice(
        0,
        turns.length,
        ...appendEventToTurn(turns, turnId, {
          id: message.id,
          type: "assistant_text",
          createdAt,
          content: message.content || "",
        })
      );
      continue;
    }

    if (message.role === "artifact_event" && metadata.artifact && typeof metadata.artifact === "object") {
      const artifact = metadata.artifact as { id: string; title: string; type: string };
      turns.splice(
        0,
        turns.length,
        ...appendEventToTurn(turns, turnId, {
          id: `artifact:${artifact.id}:${createdAt}`,
          type: "artifact",
          createdAt,
          artifact,
        })
      );
      continue;
    }

    if (message.role === "files_event" && Array.isArray(metadata.files)) {
      const files = metadata.files as GeneratedFile[];
      turns.splice(
        0,
        turns.length,
        ...appendEventToTurn(turns, turnId, {
          id: `files:${createdAt}:${message.id}`,
          type: "files",
          createdAt,
          files,
        })
      );
      continue;
    }

    if (message.role === "tool_use") {
      turns.splice(
        0,
        turns.length,
        ...updateToolCallInTurns(turns, turnId, {
          toolId: typeof metadata.toolId === "string" ? metadata.toolId : message.id,
          toolName: typeof metadata.toolName === "string" ? metadata.toolName : message.content || "tool",
          status: "running",
          createdAt,
          agent: typeof metadata.agent === "string" ? metadata.agent : undefined,
          resultKind: metadata.toolName === "delegate" ? "delegate" : "tool",
        })
      );
      continue;
    }

    if (message.role === "tool_result" || message.role === "delegate_result") {
      const namedOutputs = Array.isArray(metadata.namedOutputs)
        ? (metadata.namedOutputs as SessionNamedOutput[])
        : [];
      const factTexts = normalizeFactTexts(metadata.facts);
      const facts = factTexts.map((text, index) => ({
        id: `${turnId}:${index}:${text}`,
        text,
        source: typeof metadata.agent === "string" ? metadata.agent : "tool",
        createdAt,
      }));

      turns.splice(
        0,
        turns.length,
        ...updateToolCallInTurns(turns, turnId, {
          toolId: typeof metadata.toolId === "string" ? metadata.toolId : `${message.role}:${message.id}`,
          toolName: typeof metadata.toolName === "string" ? metadata.toolName : "tool",
          status: metadata.success ? "success" : "error",
          createdAt,
          agent: typeof metadata.agent === "string" ? metadata.agent : undefined,
          summary: typeof metadata.summary === "string" ? metadata.summary : message.content || "",
          namedOutputs,
          facts,
          resultKind: message.role === "delegate_result" ? "delegate" : "tool",
        })
      );
    }
  }

  return turns;
}

function applyArtifactToSessionSnapshot(
  currentState: SessionStateSnapshot | null,
  artifact: { id: string; title: string; type: string }
): SessionStateSnapshot {
  const nextState = currentState
    ? { ...currentState, artifacts: [...currentState.artifacts] }
    : createEmptySessionSnapshot();
  const createdAt = new Date().toISOString();
  const existingIndex = nextState.artifacts.findIndex((item) => item.id === artifact.id);

  if (existingIndex === -1) {
    nextState.artifacts.push({ ...artifact, createdAt });
  } else {
    nextState.artifacts[existingIndex] = { ...nextState.artifacts[existingIndex], ...artifact };
  }

  return nextState;
}

function applyFilesToSessionSnapshot(
  currentState: SessionStateSnapshot | null,
  files: GeneratedFile[]
): SessionStateSnapshot {
  const nextState = currentState ? { ...currentState } : createEmptySessionSnapshot();
  nextState.generatedFiles = mergeGeneratedFiles(nextState.generatedFiles, files);
  return nextState;
}

function applyToolResultToSessionSnapshot(
  currentState: SessionStateSnapshot | null,
  params: {
    agent?: string;
    resultKind?: "tool" | "delegate";
    summary?: string;
    namedOutputs?: SessionNamedOutput[];
    facts?: unknown;
  }
): SessionStateSnapshot {
  const nextState = currentState
    ? {
        ...currentState,
        namedOutputs: [...currentState.namedOutputs],
        workingFacts: [...currentState.workingFacts],
        recentDelegateResults: [...currentState.recentDelegateResults],
      }
    : createEmptySessionSnapshot();
  const createdAt = new Date().toISOString();
  const namedOutputs = (params.namedOutputs || []).map((output) => ({
    ...output,
    createdAt: output.createdAt || createdAt,
  }));
  const facts = normalizeFactTexts(params.facts).map((fact, index) => ({
    id: `${params.agent || params.resultKind || "tool"}:${fact}:${index}`,
    text: fact,
    source: params.agent || params.resultKind || "tool",
    createdAt,
  }));

  nextState.namedOutputs = mergeNamedOutputs(nextState.namedOutputs, namedOutputs);
  nextState.workingFacts = mergeWorkingFacts(nextState.workingFacts, facts);

  if (params.resultKind === "delegate" && params.agent) {
    nextState.recentDelegateResults = [
      ...nextState.recentDelegateResults,
      {
        agent: params.agent,
        summary: params.summary || "",
        namedOutputs,
        facts,
        createdAt,
      },
    ].slice(-8);
  }

  return nextState;
}

function buildPendingTurn(userMessage: string): TimelineTurn {
  return {
    id: uuidv4(),
    userMessage,
    createdAt: new Date().toISOString(),
    events: [],
  };
}

function buildStatusEvent(
  content: string,
  tone: "info" | "error"
): TimelineStatusEvent {
  return {
    id: uuidv4(),
    type: "status",
    createdAt: new Date().toISOString(),
    content,
    tone,
  };
}

function findGlobalImageIndex(files: GeneratedFile[], fileId: string): number {
  const imageFiles = files.filter((file) => file.mimeType.startsWith("image/")).reverse();
  return imageFiles.findIndex((file) => file.id === fileId);
}

// ---------------------------------------------------------------------------
// Agent tool-call grouping — collapse consecutive same-agent tool calls
// ---------------------------------------------------------------------------

type RenderItem =
  | { kind: "event"; event: TimelineEvent }
  | { kind: "agent_group"; agent: string; toolCalls: TimelineToolCallEvent[]; thinkingCount: number; files: TimelineFilesEvent[] };

function groupEventsForRendering(events: TimelineEvent[]): RenderItem[] {
  const items: RenderItem[] = [];
  let currentGroup: { agent: string; toolCalls: TimelineToolCallEvent[]; thinkingCount: number; files: TimelineFilesEvent[] } | null = null;

  function flushGroup() {
    if (currentGroup) {
      items.push({ kind: "agent_group", ...currentGroup });
      currentGroup = null;
    }
  }

  for (const event of events) {
    // Tool calls with an agent (specialist sub-tool) → group
    if (event.type === "tool_call" && event.agent && event.resultKind !== "delegate") {
      if (currentGroup && currentGroup.agent === event.agent) {
        currentGroup.toolCalls.push(event);
      } else {
        flushGroup();
        currentGroup = { agent: event.agent, toolCalls: [event], thinkingCount: 0, files: [] };
      }
      continue;
    }

    // Thinking events within an active group → absorb
    if (event.type === "thinking" && currentGroup) {
      currentGroup.thinkingCount++;
      continue;
    }

    // Files within an active group → absorb
    if (event.type === "files" && currentGroup) {
      currentGroup.files.push(event);
      continue;
    }

    // Anything else breaks the group
    flushGroup();
    items.push({ kind: "event", event });
  }

  flushGroup();
  return items;
}

const AGENT_LABELS: Record<string, { label: string; emoji: string }> = {
  db_researcher: { label: "Databasforskare", emoji: "🗄️" },
  api_researcher: { label: "API-forskare", emoji: "📡" },
  web_researcher: { label: "Webbforskare", emoji: "🌐" },
  web_browser: { label: "Webbläsare", emoji: "🖥️" },
  analyst: { label: "Analytiker", emoji: "📊" },
  doc_designer: { label: "Dokumentdesigner", emoji: "📑" },
  artifact_designer: { label: "Artifaktdesigner", emoji: "✨" },
};

function CollapsedAgentToolGroup({
  agent,
  toolCalls,
  files,
  allFiles,
  setLightboxIndex,
}: {
  agent: string;
  toolCalls: TimelineToolCallEvent[];
  files: TimelineFilesEvent[];
  allFiles: GeneratedFile[];
  setLightboxIndex: (index: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const meta = AGENT_LABELS[agent] || { label: agent, emoji: "🔧" };

  const completed = toolCalls.filter((tc) => tc.status !== "running");
  const running = toolCalls.find((tc) => tc.status === "running");
  const failed = toolCalls.filter((tc) => tc.status === "error").length;
  const allDone = !running;
  const latestCompleted = completed[completed.length - 1];

  // Collect named outputs from all completed calls
  const allOutputs = completed.flatMap((tc) => tc.namedOutputs || []);

  const statusColor = allDone
    ? failed > 0 && failed === completed.length
      ? "border-destructive/20 bg-destructive/5"
      : "border-emerald-500/20 bg-emerald-500/5"
    : "border-primary/20 bg-primary/5";

  const badgeColor = allDone
    ? failed > 0 && failed === completed.length
      ? "bg-destructive/10 text-destructive"
      : "bg-emerald-500/10 text-emerald-600"
    : "bg-primary/10 text-primary";

  return (
    <div className={`rounded-xl border px-3 py-2 shadow-sm ${statusColor}`}>
      {/* Header row */}
      <div className="flex items-center gap-2">
        <div className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ${badgeColor}`}>
          {running ? (
            <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={2} className="opacity-25" />
              <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
            </svg>
          ) : (
            <span className="text-xs">{meta.emoji}</span>
          )}
          <span>{meta.label}</span>
        </div>

        {/* Live status */}
        <span className="text-xs text-muted-foreground">
          {running
            ? `${completed.length + 1}/${toolCalls.length} verktygsanrop...`
            : `${completed.length} verktygsanrop${failed > 0 ? ` (${failed} misslyckade)` : ""}`
          }
        </span>

        {/* Expand toggle */}
        {allDone && completed.length > 1 && (
          <button
            onClick={() => setExpanded((prev) => !prev)}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? "Dölj" : "Visa detaljer"}
          </button>
        )}
      </div>

      {/* Latest status / summary when not expanded */}
      {!expanded && latestCompleted?.summary && (
        <p className="mt-1.5 text-sm text-foreground">{latestCompleted.summary}</p>
      )}

      {/* Named outputs */}
      {!expanded && allOutputs.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {allOutputs.slice(-3).map((output) => (
            <span
              key={output.key}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${
                output.type === "file" ? "bg-emerald-500/10 text-emerald-700"
                : output.type === "artifact" ? "bg-sky-500/10 text-sky-700"
                : "bg-muted text-muted-foreground"
              }`}
            >
              <span className="uppercase">{output.type}</span>
              <span>{output.label}</span>
            </span>
          ))}
        </div>
      )}

      {/* Expanded: show individual tool calls */}
      {expanded && (
        <div className="mt-2 space-y-1.5 border-t border-border/50 pt-2">
          {completed.map((tc) => (
            <div key={tc.toolId} className="flex items-center gap-2 text-xs">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={`h-3 w-3 shrink-0 ${tc.status === "error" ? "text-destructive" : "text-emerald-500"}`}>
                {tc.status === "error" ? <path d="M18 6 6 18M6 6l12 12" /> : <path d="M20 6 9 17l-5-5" />}
              </svg>
              <span className="text-muted-foreground">{tc.toolName === "run_code" ? "Kör kod" : tc.toolName}</span>
              {tc.summary && <span className="text-foreground truncate">{tc.summary}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Render any files from within the group */}
      {files.length > 0 && (
        <div className="mt-2">
          {files.map((fileEvent) => (
            <FileDownload
              key={fileEvent.id}
              files={fileEvent.files}
              onImageClick={(localIndex) => {
                const eventImages = fileEvent.files.filter((f) => f.mimeType.startsWith("image/")).reverse();
                const selectedFile = eventImages[localIndex];
                if (!selectedFile) return;
                const globalIndex = findGlobalImageIndex(allFiles, selectedFile.id);
                if (globalIndex !== -1) setLightboxIndex(globalIndex);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function renderTimelineEvent(
  event: TimelineEvent,
  allFiles: GeneratedFile[],
  setLightboxIndex: (index: number) => void
) {
  if (event.type === "assistant_text") {
    return (
      <MessageBubble
        key={event.id}
        message={{ id: event.id, role: "assistant", content: event.content }}
      />
    );
  }

  if (event.type === "thinking") {
    return (
      <div key={event.id} className="flex justify-start" aria-live="polite">
        <div className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">
          <span className="animate-pulse">Tänker...</span>
        </div>
      </div>
    );
  }

  if (event.type === "status") {
    return (
      <div key={event.id} className="flex justify-start">
        <div
          className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm shadow-sm ${
            event.tone === "error"
              ? "border-destructive/20 bg-destructive/5 text-destructive"
              : "border-border bg-card text-muted-foreground"
          }`}
        >
          <span>{event.content}</span>
        </div>
      </div>
    );
  }

  if (event.type === "agent_status") {
    const status = event.status || getAgentStatusState(event.content);
    const containerClass =
      status === "running"
        ? "border-primary/20 bg-primary/5 text-foreground"
        : status === "success"
          ? "border-emerald-500/20 bg-emerald-500/5 text-foreground"
          : "border-destructive/20 bg-destructive/5 text-destructive";

    return (
      <div key={event.id} className="flex justify-start">
        <div className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${containerClass}`}>
          {status === "running" ? (
            <svg className="h-3.5 w-3.5 animate-spin text-primary shrink-0" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={2} className="opacity-25" />
              <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 shrink-0">
              {status === "success" ? <path d="M20 6 9 17l-5-5" /> : <path d="M18 6 6 18M6 6l12 12" />}
            </svg>
          )}
          <span>{event.content}</span>
        </div>
      </div>
    );
  }

  if (event.type === "tool_call") {
    return (
      <ToolCallIndicator
        key={event.id}
        toolName={event.toolName}
        status={event.status}
        summary={event.summary}
        agent={event.agent}
        resultKind={event.resultKind}
        namedOutputs={event.namedOutputs}
        facts={event.facts?.map((fact) => fact.text)}
      />
    );
  }

  if (event.type === "artifact") {
    return (
      <div key={event.id} className="flex justify-start">
        <div className="inline-flex max-w-full items-center gap-2 rounded-xl border border-sky-500/20 bg-sky-500/5 px-3 py-2 text-sm text-foreground shadow-sm">
          <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[11px] font-semibold uppercase text-sky-700">
            Artifact
          </span>
          <span className="truncate">
            {event.artifact.title}
          </span>
        </div>
      </div>
    );
  }

  if (event.type === "files") {
    return (
      <FileDownload
        key={event.id}
        files={event.files}
        onImageClick={(localIndex) => {
          const eventImages = event.files.filter((file) => file.mimeType.startsWith("image/")).reverse();
          const selectedFile = eventImages[localIndex];
          if (!selectedFile) return;
          const globalIndex = findGlobalImageIndex(allFiles, selectedFile.id);
          if (globalIndex !== -1) {
            setLightboxIndex(globalIndex);
          }
        }}
      />
    );
  }

  return null;
}

export function ChatPanel({
  sessionId,
  onSessionCreated,
  onArtifact,
  onReplaceArtifacts,
  artifactCount,
  artifactPanelOpen,
  onToggleArtifactPanel,
  editingArtifact,
  onClearEditingArtifact,
}: ChatPanelProps) {
  const [timelineTurns, setTimelineTurns] = useState<TimelineTurn[]>([]);
  const [generatedFiles, setGeneratedFiles] = useState<GeneratedFile[]>([]);
  const [sessionSnapshot, setSessionSnapshot] = useState<SessionStateSnapshot | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isStartingResponse, setIsStartingResponse] = useState(false);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const currentTurnIdRef = useRef<string | null>(null);
  const pendingMessageRef = useRef<{
    turnId: string;
    content: string;
    provider: string;
    model: string;
    agentMode?: AgentMode;
    files?: AttachedFile[];
  } | null>(null);
  const sessionIdRef = useRef<string | null>(sessionId);
  const onSessionCreatedRef = useRef(onSessionCreated);
  const onArtifactRef = useRef(onArtifact);
  const onReplaceArtifactsRef = useRef(onReplaceArtifacts);

  useEffect(() => {
    onSessionCreatedRef.current = onSessionCreated;
  }, [onSessionCreated]);

  useEffect(() => {
    onArtifactRef.current = onArtifact;
  }, [onArtifact]);

  useEffect(() => {
    onReplaceArtifactsRef.current = onReplaceArtifacts;
  }, [onReplaceArtifacts]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const resetSessionState = useEffectEvent(() => {
    setTimelineTurns([]);
    setGeneratedFiles([]);
    setSessionSnapshot(null);
    setIsStreaming(false);
    setIsStartingResponse(false);
    currentTurnIdRef.current = null;
    setActiveTurnId(null);
  });

  const prevSessionIdRef = useRef<string | null>(sessionId);
  useEffect(() => {
    const previousSessionId = prevSessionIdRef.current;
    prevSessionIdRef.current = sessionId;
    if (previousSessionId !== null && previousSessionId !== sessionId) {
      resetSessionState();
    }
  }, [sessionId]);

  const sendRef = useRef<(msg: WSMessage) => void>(() => {});

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    bottomRef.current?.scrollIntoView({ block: "end", behavior });
  }, []);

  const updateStickToBottom = useCallback(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    shouldStickToBottomRef.current = distanceFromBottom < 160;
  }, []);

  const appendEventToTurnId = useCallback((turnId: string | null | undefined, eventFactory: () => TimelineEvent) => {
    if (!turnId) return;
    setTimelineTurns((prev) => appendEventToTurn(prev, turnId, eventFactory()));
  }, []);

  const updateToolCallOnTurnId = useCallback((turnId: string | null | undefined, params: {
    toolId: string;
    toolName: string;
    status: "running" | "success" | "error";
    createdAt: string;
    agent?: string;
    summary?: string;
    namedOutputs?: SessionNamedOutput[];
    facts?: SessionWorkingFact[];
    resultKind?: "tool" | "delegate";
  }) => {
    if (!turnId) return;
    setTimelineTurns((prev) => updateToolCallInTurns(prev, turnId, params));
  }, []);

  const onMessage = useCallback((msg: WSMessage) => {
    switch (msg.type) {
      case "session_created": {
        const newSessionId = msg.sessionId as string;
        sessionIdRef.current = newSessionId;
        onSessionCreatedRef.current(newSessionId);
        const pending = pendingMessageRef.current;
        if (pending) {
          pendingMessageRef.current = null;
          currentTurnIdRef.current = pending.turnId;
          setActiveTurnId(pending.turnId);
          sendRef.current({
            type: "chat",
            sessionId: newSessionId,
            turnId: pending.turnId,
            content: pending.content,
            provider: pending.provider,
            model: pending.model,
            ...(pending.files && pending.files.length > 0 ? { attachments: pending.files } : {}),
            ...(pending.agentMode && pending.agentMode !== "auto" ? { agentMode: pending.agentMode } : {}),
          });
        }
        break;
      }
      case "history":
        setTimelineTurns(buildFallbackTimelineFromHistory((msg.messages as HistoryMessage[]) || []));
        setGeneratedFiles([]);
        setSessionSnapshot(null);
        if (!currentTurnIdRef.current) {
          setIsStreaming(false);
          setIsStartingResponse(false);
          setActiveTurnId(null);
        }
        onReplaceArtifactsRef.current?.([]);
        break;
      case "session_state": {
        const nextState = (msg.state as SessionStateSnapshot | null) || null;
        setSessionSnapshot(nextState);
        if (nextState?.timelineTurns?.length) {
          setTimelineTurns(nextState.timelineTurns);
        }
        setGeneratedFiles(nextState?.generatedFiles || []);
        break;
      }
      case "artifacts_snapshot":
        onReplaceArtifactsRef.current?.((msg.artifacts as ArtifactSnapshot[]) || []);
        setSessionSnapshot((current) => {
          const nextState = current ? { ...current } : createEmptySessionSnapshot();
          nextState.artifacts = ((msg.artifacts as ArtifactSnapshot[]) || []).map((artifact) => ({
            id: artifact.id,
            title: artifact.title,
            type: artifact.type,
          }));
          return nextState;
        });
        break;
      case "files_snapshot":
        setGeneratedFiles((msg.files as GeneratedFile[]) || []);
        setSessionSnapshot((current) => {
          const nextState = current ? { ...current } : createEmptySessionSnapshot();
          nextState.generatedFiles = (msg.files as GeneratedFile[]) || [];
          return nextState;
        });
        break;
      case "thinking":
        setIsStartingResponse(false);
        setIsStreaming(true);
        appendEventToTurnId((msg.turnId as string | undefined) || currentTurnIdRef.current, () => ({
          id: uuidv4(),
          type: "thinking",
          createdAt: new Date().toISOString(),
        }));
        break;
      case "text_delta":
        setIsStartingResponse(false);
        setIsStreaming(true);
        appendEventToTurnId((msg.turnId as string | undefined) || currentTurnIdRef.current, () => ({
          id: `assistant-stream:${uuidv4()}`,
          type: "assistant_text",
          createdAt: new Date().toISOString(),
          content: msg.content as string,
        }));
        break;
      case "tool_use":
        setIsStartingResponse(false);
        setIsStreaming(true);
        updateToolCallOnTurnId((msg.turnId as string | undefined) || currentTurnIdRef.current, {
          toolId: msg.toolId as string,
          toolName: msg.toolName as string,
          status: "running",
          createdAt: new Date().toISOString(),
          agent: msg.agent as string | undefined,
          resultKind: msg.toolName === "delegate" ? "delegate" : "tool",
        });
        break;
      case "tool_result":
        setIsStartingResponse(false);
        updateToolCallOnTurnId((msg.turnId as string | undefined) || currentTurnIdRef.current, {
          toolId: msg.toolId as string,
          toolName: msg.toolName as string,
          status: (msg.success ? "success" : "error") as "success" | "error",
          createdAt: new Date().toISOString(),
          agent: msg.agent as string | undefined,
          summary: msg.summary as string | undefined,
          namedOutputs: (msg.namedOutputs as SessionNamedOutput[] | undefined) || [],
          facts: normalizeFactTexts(msg.facts).map((text, index) => ({
            id: `${msg.toolId}:${index}:${text}`,
            text,
            source: (msg.agent as string | undefined) || "tool",
            createdAt: new Date().toISOString(),
          })),
          resultKind: msg.resultKind as "tool" | "delegate" | undefined,
        });
        setSessionSnapshot((current) =>
          applyToolResultToSessionSnapshot(current, {
            agent: msg.agent as string | undefined,
            resultKind: msg.resultKind as "tool" | "delegate" | undefined,
            summary: msg.summary as string | undefined,
            namedOutputs: (msg.namedOutputs as SessionNamedOutput[] | undefined) || [],
            facts: msg.facts,
          })
        );
        break;
      case "files":
        setIsStartingResponse(false);
        if (msg.files) {
          const incomingFiles = msg.files as GeneratedFile[];
          setGeneratedFiles((prev) => mergeGeneratedFiles(prev, incomingFiles));
          appendEventToTurnId((msg.turnId as string | undefined) || currentTurnIdRef.current, () => ({
            id: `files:${uuidv4()}`,
            type: "files",
            createdAt: new Date().toISOString(),
            files: incomingFiles,
          }));
          setSessionSnapshot((current) => applyFilesToSessionSnapshot(current, incomingFiles));
        }
        break;
      case "agent_status":
        setIsStartingResponse(false);
        setIsStreaming(true);
        appendEventToTurnId((msg.turnId as string | undefined) || currentTurnIdRef.current, () => ({
          id: `agent:${uuidv4()}`,
          type: "agent_status",
          createdAt: new Date().toISOString(),
          agent: msg.agent as string | undefined,
          content: msg.content as string,
          status: getAgentStatusState((msg.content as string) || ""),
        }));
        break;
      case "artifact":
        appendEventToTurnId((msg.turnId as string | undefined) || currentTurnIdRef.current, () => ({
          id: `artifact:${msg.id as string}`,
          type: "artifact",
          createdAt: new Date().toISOString(),
          artifact: {
            id: msg.id as string,
            title: msg.title as string,
            type: msg.artifactType as string,
          },
        }));
        setSessionSnapshot((current) =>
          applyArtifactToSessionSnapshot(current, {
            id: msg.id as string,
            title: msg.title as string,
            type: msg.artifactType as string,
          })
        );
        onArtifactRef.current?.({
          id: msg.id as string,
          title: msg.title as string,
          type: msg.artifactType as string,
          content: msg.content as string,
        });
        break;
      case "done":
        setIsStartingResponse(false);
        setIsStreaming(false);
        currentTurnIdRef.current = null;
        setActiveTurnId(null);
        break;
      case "error":
        appendEventToTurnId((msg.turnId as string | undefined) || currentTurnIdRef.current, () => buildStatusEvent((msg.message as string) || "Ett fel uppstod.", "error"));
        setIsStartingResponse(false);
        setIsStreaming(false);
        currentTurnIdRef.current = null;
        setActiveTurnId(null);
        break;
    }
  }, [appendEventToTurnId, updateToolCallOnTurnId]);

  const { connect, send, connected } = useWebSocket({ onMessage });

  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  useEffect(() => {
    connect();
  }, [connect]);

  useEffect(() => {
    if (connected && sessionId) {
      send({ type: "subscribe", sessionId });
    }
  }, [connected, sessionId, send]);

  useEffect(() => {
    if (!shouldStickToBottomRef.current) return;
    const frame = requestAnimationFrame(() => scrollToBottom("auto"));
    return () => cancelAnimationFrame(frame);
  }, [timelineTurns, generatedFiles, isStartingResponse, scrollToBottom]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      if (shouldStickToBottomRef.current) {
        scrollToBottom("auto");
      }
    });

    observer.observe(content);
    return () => observer.disconnect();
  }, [scrollToBottom]);

  const handleSend = (content: string, provider: string, model: string, files?: AttachedFile[], agentMode?: AgentMode) => {
    const displayContent = files && files.length > 0
      ? `${content}\n\n${files.map((file) => `[${file.filename}]`).join(" ")}`
      : content;

    const pendingTurn = buildPendingTurn(displayContent);
    currentTurnIdRef.current = pendingTurn.id;
    setActiveTurnId(pendingTurn.id);
    setTimelineTurns((prev) => [...prev, pendingTurn]);
    setIsStreaming(true);
    setIsStartingResponse(true);
    shouldStickToBottomRef.current = true;

    let fullContent = content;
    if (editingArtifact) {
      fullContent = `[REDIGERA ARTIFACT: "${editingArtifact.title}"]\n\nAnvändarens instruktion: ${content}\n\n<existing-artifact type="${editingArtifact.type}">\n${editingArtifact.content}\n</existing-artifact>`;
      onClearEditingArtifact?.();
    }

    const currentSessionId = sessionIdRef.current;
    if (!currentSessionId) {
      pendingMessageRef.current = {
        turnId: pendingTurn.id,
        content: fullContent,
        provider,
        model,
        agentMode,
        files,
      };
      send({ type: "new_session" });
      return;
    }

    send({
      type: "chat",
      sessionId: currentSessionId,
      turnId: pendingTurn.id,
      content: fullContent,
      provider,
      model,
      ...(files && files.length > 0 ? { attachments: files } : {}),
      ...(agentMode && agentMode !== "auto" ? { agentMode } : {}),
    });
  };

  const renderPreparingState = (turn: TimelineTurn) => {
    if (!isStartingResponse || activeTurnId !== turn.id || turn.events.length > 0) {
      return null;
    }

    return (
      <div className="flex justify-start" aria-live="polite">
        <div className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm">
          <svg className="h-3.5 w-3.5 animate-spin text-primary shrink-0" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={2} className="opacity-25" />
            <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
          </svg>
          <span>Förbereder svar...</span>
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col">
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

      <div ref={scrollRef} onScroll={updateStickToBottom} className="flex-1 overflow-y-auto p-4">
        <div ref={contentRef} className="mx-auto max-w-3xl space-y-5">
          {timelineTurns.length === 0 && !isStreaming && (
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

          <SessionContextPanel state={sessionSnapshot} />

          {timelineTurns.map((turn) => (
            <section key={turn.id} className="space-y-3">
              <MessageBubble
                message={{ id: turn.userMessageId || turn.id, role: "user", content: turn.userMessage }}
              />

              {renderPreparingState(turn)}

              {groupEventsForRendering(turn.events).map((item) =>
                item.kind === "event"
                  ? renderTimelineEvent(item.event, generatedFiles, setLightboxIndex)
                  : (
                    <CollapsedAgentToolGroup
                      key={`group:${item.agent}:${item.toolCalls[0]?.toolId}`}
                      agent={item.agent}
                      toolCalls={item.toolCalls}
                      files={item.files}
                      allFiles={generatedFiles}
                      setLightboxIndex={setLightboxIndex}
                    />
                  )
              )}
            </section>
          ))}

          <div ref={bottomRef} className="h-px" />
        </div>
      </div>

      {editingArtifact && (
        <div className="flex items-center gap-2 border-t border-border bg-muted/50 px-4 py-2">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-muted-foreground shrink-0">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          <span className="text-xs text-muted-foreground truncate">
            Redigerar: <span className="font-medium text-foreground">{editingArtifact.title}</span>
          </span>
          <button
            onClick={onClearEditingArtifact}
            className="ml-auto text-muted-foreground hover:text-foreground"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      <ChatInput
        onSend={handleSend}
        onAbort={() => {
          const sid = sessionIdRef.current;
          if (sid) send({ type: "abort", sessionId: sid });
          pendingMessageRef.current = null;
          currentTurnIdRef.current = null;
          setActiveTurnId(null);
          setIsStreaming(false);
          setIsStartingResponse(false);
          setTimelineTurns((prev) => {
            if (prev.length === 0) return prev;
            const nextTurns = [...prev];
            const lastTurn = nextTurns[nextTurns.length - 1];
            nextTurns[nextTurns.length - 1] = {
              ...lastTurn,
              events: [...lastTurn.events, buildStatusEvent("Svar avbrutet.", "info")],
            };
            return nextTurns;
          });
        }}
        disabled={isStreaming}
      />

      {lightboxIndex !== null && (() => {
        const imageFiles = generatedFiles
          .filter((file) => file.mimeType.startsWith("image/"))
          .reverse();
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
