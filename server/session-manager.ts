import { WebSocket } from "ws";
import { readFile } from "fs/promises";
import path from "path";
import { db } from "./db";
import { chatSessions, chatMessages, artifacts, generatedFiles } from "./db/schema";
import { eq, desc } from "drizzle-orm";
import { streamLLM, type LLMProvider, type ChatMessage } from "./llm-provider";
import { streamAgentTeam, type AgentTeamMode } from "./agent-team";

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

    // Send saved artifacts
    const sessionArtifacts = await db
      .select()
      .from(artifacts)
      .where(eq(artifacts.sessionId, sessionId))
      .orderBy(artifacts.createdAt);

    for (const a of sessionArtifacts) {
      ws.send(JSON.stringify({
        type: "artifact",
        id: a.id,
        title: a.title,
        artifactType: a.type,
        content: a.content,
      }));
    }

    // Send saved files
    const sessionFiles = await db
      .select()
      .from(generatedFiles)
      .where(eq(generatedFiles.sessionId, sessionId))
      .orderBy(generatedFiles.createdAt);

    if (sessionFiles.length > 0) {
      ws.send(JSON.stringify({
        type: "files",
        files: sessionFiles.map((f) => ({
          id: f.id,
          filename: f.filename,
          mimeType: f.mimeType,
          sizeBytes: f.sizeBytes,
        })),
      }));
    }
  }

  async handleChat(
    ws: WebSocket,
    userEmail: string,
    sessionId: string,
    content: string,
    provider?: LLMProvider,
    model?: string,
    attachments?: Attachment[],
    agentMode?: AgentTeamMode
  ) {
    const llmProvider = provider || (process.env.LLM_PROVIDER as LLMProvider) || "anthropic";

    // Build content with file attachments
    let fullContent = content;
    if (attachments && attachments.length > 0) {
      const fileParts: string[] = [];
      for (const att of attachments) {
        try {
          // Find the uploaded file
          const ext = path.extname(att.filename) || "";
          const filePath = path.join(UPLOADS_DIR, `${att.id}${ext}`);

          // Only include text-readable files inline
          if (isTextFile(att.mimeType)) {
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

    const chatHistory: ChatMessage[] = history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content || "",
      }));

    // Stream response
    const abortController = new AbortController();
    this.activeSessions.set(sessionId, { abortController });

    let fullResponse = "";

    // Choose streaming mode: agent team or flat loop
    const effectiveMode = agentMode || "auto";
    const streamSource =
      effectiveMode === "simple"
        ? streamLLM(llmProvider, chatHistory, model, sessionId)
        : streamAgentTeam(chatHistory, llmProvider, model, sessionId, effectiveMode);

    try {
      for await (const event of streamSource) {
        if (abortController.signal.aborted) break;

        if (event.type === "text_delta" && event.content) {
          fullResponse += event.content;
        }

        // Persist artifacts to DB
        if (event.type === "artifact" && event.id && event.title && event.artifactType && event.content) {
          await db.insert(artifacts).values({
            id: event.id,
            sessionId,
            title: event.title,
            type: event.artifactType,
            content: event.content,
          });
        }

        ws.send(JSON.stringify(event));
      }

      // Save assistant response
      if (fullResponse) {
        await db.insert(chatMessages).values({
          sessionId,
          role: "assistant",
          content: fullResponse,
        });
      }
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
