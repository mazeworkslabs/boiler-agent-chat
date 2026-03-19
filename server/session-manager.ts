import { WebSocket } from "ws";
import { randomUUID } from "crypto";
import { readFile } from "fs/promises";
import path from "path";
import { db } from "./db";
import { chatSessions, chatMessages, artifacts, generatedFiles } from "./db/schema";
import { and, eq, desc } from "drizzle-orm";
import { streamLLM, type LLMProvider, type ChatMessage } from "./llm-provider";
import { streamAgentTeam, type AgentTeamMode } from "./agent-team";
import {
  applyArtifactToSessionState,
  appendAgentStatusToSessionState,
  appendAssistantTextToSessionState,
  appendThinkingToSessionState,
  applyExecutionToSessionState,
  applyFilesToSessionState,
  buildSessionState,
  createSessionStateSnapshot,
  startToolCallInSessionState,
  startTurnInSessionState,
  type SessionState,
} from "./session-state";
import { compressMessageForModelHistory, hasEmbeddedPayloads } from "./utils/multimodal";

interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

interface ActiveSession {
  abortController: AbortController;
}

export class SessionManager {
  private activeSessions = new Map<string, ActiveSession>();

  async createSession(ws: WebSocket, userEmail: string) {
    const [session] = await db
      .insert(chatSessions)
      .values({ userEmail })
      .returning();

    ws.send(JSON.stringify({ type: "session_created", sessionId: session.id }));
  }

  async subscribeSession(ws: WebSocket, userEmail: string, sessionId: string) {
    // Verify ownership
    const [session] = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, sessionId));

    if (!session || session.userEmail !== userEmail) {
      ws.send(JSON.stringify({ type: "error", message: "Session not found" }));
      return;
    }

    // Send history
    const messages = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(chatMessages.createdAt);

    ws.send(JSON.stringify({ type: "history", messages }));

    const [latestStateSnapshot] = await db
      .select({ metadata: chatMessages.metadata })
      .from(chatMessages)
      .where(and(eq(chatMessages.sessionId, sessionId), eq(chatMessages.role, "session_state")))
      .orderBy(desc(chatMessages.createdAt))
      .limit(1);

    const payload = latestStateSnapshot?.metadata as { kind?: string; state?: SessionState } | undefined;
    ws.send(JSON.stringify({
      type: "session_state",
      state: payload?.state || null,
    }));

    const sessionArtifacts = await db
      .select()
      .from(artifacts)
      .where(eq(artifacts.sessionId, sessionId))
      .orderBy(artifacts.createdAt);

    ws.send(JSON.stringify({
      type: "artifacts_snapshot",
      artifacts: sessionArtifacts.map((artifact) => ({
        id: artifact.id,
        title: artifact.title,
        type: artifact.type,
        content: artifact.content,
      })),
    }));

    const sessionFiles = await db
      .select()
      .from(generatedFiles)
      .where(eq(generatedFiles.sessionId, sessionId))
      .orderBy(generatedFiles.createdAt);

    ws.send(JSON.stringify({
      type: "files_snapshot",
      files: sessionFiles.map((file) => ({
        id: file.id,
        filename: file.filename,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes ?? 0,
      })),
    }));
  }

  async handleChat(
    ws: WebSocket,
    userEmail: string,
    sessionId: string,
    content: string,
    provider?: LLMProvider,
    model?: string,
    attachments?: Attachment[],
    agentMode?: AgentTeamMode,
    clientTurnId?: string
  ) {
    const llmProvider = provider || (process.env.LLM_PROVIDER as LLMProvider) || "anthropic";
    const turnId = clientTurnId || randomUUID();

    const [session] = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, sessionId));

    if (!session || session.userEmail !== userEmail) {
      ws.send(JSON.stringify({ type: "error", message: "Session not found" }));
      return;
    }

    // Build content with file attachments
    let fullContent = content;
    if (attachments && attachments.length > 0) {
      const fileParts: string[] = [];
      for (const att of attachments) {
        try {
          // Find the uploaded file
          const ext = path.extname(att.filename) || "";
          const filePath = path.join(UPLOADS_DIR, `${att.id}${ext}`);

          // Route by file type
          if (att.mimeType === "application/pdf") {
            // PDF: store as attachment marker — will be sent as native multimodal to LLM
            fileParts.push(`<attachment type="pdf" id="${att.id}" filename="${att.filename}" />`);
          } else if (att.mimeType.startsWith("image/")) {
            // Image: store as attachment marker — will be sent as native vision input
            fileParts.push(`<attachment type="image" id="${att.id}" filename="${att.filename}" mimeType="${att.mimeType}" />`);
          } else if (isTextFile(att.mimeType)) {
            const fileContent = await readFile(filePath, "utf-8");
            const truncated = fileContent.length > 50000
              ? fileContent.slice(0, 50000) + "\n\n... (trunkerat)"
              : fileContent;
            fileParts.push(`<file name="${att.filename}" type="${att.mimeType}">\n${truncated}\n</file>`);
          } else {
            fileParts.push(`<file name="${att.filename}" type="${att.mimeType}" size="${att.sizeBytes}">[Binär fil — kan inte visas som text]</file>`);
          }
        } catch {
          fileParts.push(`<file name="${att.filename}">[Kunde inte läsa fil]</file>`);
        }
      }
      fullContent = `${content}\n\n${fileParts.join("\n\n")}`;
    }

    // Save user message
    await db.insert(chatMessages).values({
      sessionId,
      role: "user",
      content: fullContent,
      metadata: { turnId },
    });

    // Update session title from first message
    const msgCount = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId));

    if (msgCount.length <= 1) {
      const title = content.slice(0, 60) + (content.length > 60 ? "..." : "");
      await db
        .update(chatSessions)
        .set({ title, updatedAt: new Date() })
        .where(eq(chatSessions.id, sessionId));
    }

    // Build conversation history
    const history = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(chatMessages.createdAt);

    const latestUserIndex = history.reduce((latestIndex, message, index) => (
      message.role === "user" ? index : latestIndex
    ), -1);
    const latestPayloadUserIndex = history.reduce((latestIndex, message, index) => {
      if (message.role !== "user" || !message.content || !hasEmbeddedPayloads(message.content)) {
        return latestIndex;
      }
      return index;
    }, -1);
    const rawUserIndices = new Set<number>(latestUserIndex >= 0 ? [latestUserIndex] : []);
    if (latestPayloadUserIndex >= 0) {
      rawUserIndices.add(latestPayloadUserIndex);
    }

    const historyIndexById = new Map(history.map((message, index) => [message.id, index]));

    const chatHistory: ChatMessage[] = history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => {
        const originalIndex = historyIndexById.get(m.id) ?? -1;
        const content =
          m.role === "user" && !rawUserIndices.has(originalIndex)
            ? compressMessageForModelHistory(m.content || "")
            : m.content || "";

        return {
          role: m.role as "user" | "assistant",
          content,
        };
      });

    const sessionArtifacts = await db
      .select()
      .from(artifacts)
      .where(eq(artifacts.sessionId, sessionId))
      .orderBy(artifacts.createdAt);

    const sessionFiles = await db
      .select()
      .from(generatedFiles)
      .where(eq(generatedFiles.sessionId, sessionId))
      .orderBy(generatedFiles.createdAt);

    let currentSessionState: SessionState = buildSessionState({
      sessionId,
      messages: history,
      artifacts: sessionArtifacts,
      files: sessionFiles,
    });
    currentSessionState.userEmail = userEmail;
    currentSessionState = startTurnInSessionState(currentSessionState, {
      turnId,
      userMessage: fullContent,
      createdAt: new Date().toISOString(),
    });

    // Stream response
    const abortController = new AbortController();
    this.activeSessions.set(sessionId, { abortController });

    let fullResponse = "";
    let assistantSegmentBuffer = "";

    const flushAssistantSegment = async (createdAt: string) => {
      if (!assistantSegmentBuffer) return;
      await db.insert(chatMessages).values({
        sessionId,
        role: "assistant_segment",
        content: assistantSegmentBuffer,
        metadata: { turnId },
      });
      currentSessionState = appendAssistantTextToSessionState(
        currentSessionState,
        turnId,
        assistantSegmentBuffer,
        createdAt
      );
      assistantSegmentBuffer = "";
    };

    // Choose streaming mode: agent team or flat loop
    const effectiveMode = agentMode || "auto";
    const streamSource =
      effectiveMode === "simple"
        ? streamLLM(llmProvider, chatHistory, model, sessionId, currentSessionState)
        : streamAgentTeam(chatHistory, llmProvider, model, sessionId, effectiveMode, currentSessionState);

    try {
      for await (const event of streamSource) {
        if (abortController.signal.aborted) break;
        const eventCreatedAt = new Date().toISOString();

        if (event.type === "text_delta" && event.content) {
          fullResponse += event.content;
          assistantSegmentBuffer += event.content;
        } else if (
          assistantSegmentBuffer &&
          (
            event.type === "thinking" ||
            event.type === "agent_status" ||
            event.type === "tool_use" ||
            event.type === "tool_result" ||
            event.type === "artifact" ||
            event.type === "files" ||
            event.type === "done" ||
            event.type === "error"
          )
        ) {
          await flushAssistantSegment(eventCreatedAt);
        }

        // Persist artifacts to DB
        if (event.type === "artifact" && event.id && event.title && event.artifactType && event.content) {
          try {
            await db
              .insert(artifacts)
              .values({
                id: event.id,
                sessionId,
                title: event.title,
                type: event.artifactType,
                content: event.content,
              })
              .onConflictDoUpdate({
                target: artifacts.id,
                set: {
                  title: event.title,
                  type: event.artifactType,
                  content: event.content,
                },
              });
          } catch (artifactError) {
            console.error("[Artifacts] Failed to persist artifact:", artifactError);
          }
          currentSessionState = applyArtifactToSessionState(currentSessionState, {
            id: event.id,
            title: event.title,
            type: event.artifactType,
          }, eventCreatedAt, turnId);
          await db.insert(chatMessages).values({
            sessionId,
            role: "artifact_event",
            content: event.title,
            metadata: {
              turnId,
              artifact: {
                id: event.id,
                title: event.title,
                type: event.artifactType,
              },
            },
          });
        }

        if (event.type === "files" && event.files) {
          currentSessionState = applyFilesToSessionState(currentSessionState, event.files, eventCreatedAt, turnId);
          await db.insert(chatMessages).values({
            sessionId,
            role: "files_event",
            content: event.files.map((file) => file.filename).join(", "),
            metadata: {
              turnId,
              files: event.files,
            },
          });
        }

        if (event.type === "thinking") {
          await db.insert(chatMessages).values({
            sessionId,
            role: "thinking",
            content: "thinking",
            metadata: { turnId },
          });
          currentSessionState = appendThinkingToSessionState(currentSessionState, turnId, eventCreatedAt);
        }

        if (event.type === "agent_status" && event.content) {
          await db.insert(chatMessages).values({
            sessionId,
            role: "agent_status",
            content: event.content,
            metadata: {
              turnId,
              agent: event.agent,
            },
          });
          currentSessionState = appendAgentStatusToSessionState(currentSessionState, turnId, {
            createdAt: eventCreatedAt,
            content: event.content,
            agent: event.agent,
          });
        }

        if (event.type === "tool_use" && event.toolName && event.toolId) {
          await db.insert(chatMessages).values({
            sessionId,
            role: "tool_use",
            content: event.toolName,
            metadata: {
              kind: event.toolName === "delegate" ? "delegate" : "tool",
              turnId,
              toolId: event.toolId,
              toolName: event.toolName,
              input: event.input,
              agent: event.agent,
            },
          });
          currentSessionState = startToolCallInSessionState(currentSessionState, turnId, {
            toolId: event.toolId,
            toolName: event.toolName,
            createdAt: eventCreatedAt,
            input: event.input,
            agent: event.agent,
            resultKind: event.toolName === "delegate" ? "delegate" : "tool",
          });
        }

        if (event.type === "tool_result" && event.toolId && typeof event.success === "boolean") {
          const metadata = {
            kind: event.resultKind || "tool",
            turnId,
            toolId: event.toolId,
            toolName: event.toolName || (event.resultKind === "delegate" ? "delegate" : "unknown"),
            success: event.success,
            summary: event.summary || "",
            agent: event.agent,
            namedOutputs: event.namedOutputs || [],
            facts: event.facts || [],
          };

          await db.insert(chatMessages).values({
            sessionId,
            role: event.resultKind === "delegate" ? "delegate_result" : "tool_result",
            content: event.summary || "",
            metadata,
          });

          currentSessionState = applyExecutionToSessionState(currentSessionState, {
            kind: event.resultKind === "delegate" ? "delegate" : "tool",
            toolName: metadata.toolName,
            success: event.success,
            summary: metadata.summary,
            agent: event.agent as string | undefined,
            createdAt: eventCreatedAt,
            namedOutputs: event.namedOutputs,
            facts: event.facts,
            turnId,
            toolId: event.toolId,
          });
        }

        ws.send(JSON.stringify({ ...event, turnId }));
      }

      await flushAssistantSegment(new Date().toISOString());

      // Save assistant response
      if (fullResponse) {
        await db.insert(chatMessages).values({
          sessionId,
          role: "assistant",
          content: fullResponse,
          metadata: { turnId },
        });
      }

      await db.insert(chatMessages).values({
        sessionId,
        role: "session_state",
        content: null,
        metadata: createSessionStateSnapshot(currentSessionState),
      });

      await db
        .update(chatSessions)
        .set({ updatedAt: new Date() })
        .where(eq(chatSessions.id, sessionId));
    } catch (err) {
      console.error("[LLM] Stream error:", err);
      ws.send(
        JSON.stringify({
          type: "error",
          message: err instanceof Error ? err.message : "LLM error",
        })
      );
    } finally {
      this.activeSessions.delete(sessionId);
    }
  }

  abortSession(sessionId: string) {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.abortController.abort();
      this.activeSessions.delete(sessionId);
    }
  }
}

function isTextFile(mimeType: string): boolean {
  if (mimeType.startsWith("text/")) return true;
  const textTypes = [
    "application/json",
    "application/xml",
    "application/javascript",
    "application/typescript",
    "application/csv",
    "application/x-yaml",
    "application/sql",
  ];
  return textTypes.includes(mimeType);
}
