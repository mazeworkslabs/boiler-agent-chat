import { compressMessageForModelHistory, parseAttachments } from "./utils/multimodal";

export type NamedOutputType = "artifact" | "file" | "text" | "data" | "summary";

export interface SessionAttachment {
  id: string;
  filename: string;
  mimeType: string;
  sourceMessageId?: string;
  createdAt: string;
}

export interface SessionArtifactState {
  id: string;
  title: string;
  type: string;
  createdAt: string;
}

export interface SessionGeneratedFileState {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface SessionNamedOutput {
  key: string;
  type: NamedOutputType;
  label: string;
  value: string;
  refId?: string;
  source: string;
  createdAt: string;
}

export interface SessionWorkingFact {
  id: string;
  text: string;
  source: string;
  createdAt: string;
}

export interface SessionExecutionRecord {
  toolName: string;
  success: boolean;
  summary: string;
  agent?: string;
  namedOutputs: SessionNamedOutput[];
  facts: SessionWorkingFact[];
  createdAt: string;
}

export interface SessionDelegateRecord {
  agent: string;
  summary: string;
  namedOutputs: SessionNamedOutput[];
  facts: SessionWorkingFact[];
  createdAt: string;
}

export interface SessionTimelineTurn {
  id: string;
  userMessageId?: string;
  userMessage: string;
  createdAt: string;
  events: SessionTimelineEvent[];
}

interface SessionTimelineEventBase {
  id: string;
  createdAt: string;
  agent?: string;
}

export interface SessionTimelineThinkingEvent extends SessionTimelineEventBase {
  type: "thinking";
}

export interface SessionTimelineAgentStatusEvent extends SessionTimelineEventBase {
  type: "agent_status";
  content: string;
  status?: "running" | "success" | "error";
}

export interface SessionTimelineAssistantTextEvent extends SessionTimelineEventBase {
  type: "assistant_text";
  content: string;
}

export interface SessionTimelineToolCallEvent extends SessionTimelineEventBase {
  type: "tool_call";
  toolId: string;
  toolName: string;
  status: "running" | "success" | "error";
  input?: Record<string, unknown>;
  summary?: string;
  namedOutputs: SessionNamedOutput[];
  facts: SessionWorkingFact[];
  resultKind: "tool" | "delegate";
}

export interface SessionTimelineArtifactEvent extends SessionTimelineEventBase {
  type: "artifact";
  artifact: {
    id: string;
    title: string;
    type: string;
  };
}

export interface SessionTimelineFilesEvent extends SessionTimelineEventBase {
  type: "files";
  files: SessionGeneratedFileState[];
}

export type SessionTimelineEvent =
  | SessionTimelineThinkingEvent
  | SessionTimelineAgentStatusEvent
  | SessionTimelineAssistantTextEvent
  | SessionTimelineToolCallEvent
  | SessionTimelineArtifactEvent
  | SessionTimelineFilesEvent;

export interface SessionState {
  version: 2;
  sessionId: string;
  userEmail?: string;
  latestUserMessage: string | null;
  attachments: SessionAttachment[];
  artifacts: SessionArtifactState[];
  generatedFiles: SessionGeneratedFileState[];
  namedOutputs: SessionNamedOutput[];
  workingFacts: SessionWorkingFact[];
  recentToolResults: SessionExecutionRecord[];
  recentDelegateResults: SessionDelegateRecord[];
  timelineTurns: SessionTimelineTurn[];
}

interface ChatMessageRecord {
  id: string;
  role: string;
  content: string | null;
  metadata: unknown;
  createdAt: Date | string | null;
}

interface ArtifactRecord {
  id: string;
  title: string;
  type: string;
  createdAt: Date | string | null;
}

interface FileRecord {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number | null;
  createdAt: Date | string | null;
}

interface ExecutionMetadataShape {
  toolName?: string;
  success?: boolean;
  summary?: string;
  agent?: string;
  namedOutputs?: SessionNamedOutput[];
  facts?: SessionWorkingFact[] | string[];
}

interface TimelineMessageMetadataShape extends ExecutionMetadataShape {
  turnId?: string;
  toolId?: string;
  input?: Record<string, unknown>;
  resultKind?: "tool" | "delegate";
  artifact?: {
    id: string;
    title: string;
    type: string;
  };
  files?: Array<{ id: string; filename: string; mimeType: string; sizeBytes: number }>;
}

function toIsoString(value: Date | string | null | undefined): string {
  if (!value) return new Date(0).toISOString();
  if (typeof value === "string") return value;
  return value.toISOString();
}

function sanitizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9åäö]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "output";
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function normalizeFact(
  fact: SessionWorkingFact | string,
  source: string,
  createdAt: string
): SessionWorkingFact {
  if (typeof fact === "string") {
    return {
      id: `${source}:${sanitizeKey(fact)}`,
      text: fact,
      source,
      createdAt,
    };
  }

  return {
    id: fact.id || `${source}:${sanitizeKey(fact.text)}`,
    text: fact.text,
    source: fact.source || source,
    createdAt: fact.createdAt || createdAt,
  };
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

function parseExecutionMetadata(metadata: unknown): ExecutionMetadataShape | null {
  if (!metadata || typeof metadata !== "object") return null;
  return metadata as ExecutionMetadataShape;
}

function parseTimelineMetadata(metadata: unknown): TimelineMessageMetadataShape | null {
  if (!metadata || typeof metadata !== "object") return null;
  return metadata as TimelineMessageMetadataShape;
}

function toTimelineFiles(
  files: Array<{ id: string; filename: string; mimeType: string; sizeBytes: number }>,
  createdAt: string
): SessionGeneratedFileState[] {
  return files.map((file) => ({
    id: file.id,
    filename: file.filename,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    createdAt,
  }));
}

function upsertNamedOutputs(
  existing: SessionNamedOutput[],
  incoming: SessionNamedOutput[]
): SessionNamedOutput[] {
  const next = [...existing];
  const indexByKey = new Map(next.map((output, index) => [output.key, index]));

  for (const output of incoming) {
    const index = indexByKey.get(output.key);
    if (index == null) {
      indexByKey.set(output.key, next.length);
      next.push(output);
      continue;
    }
    next[index] = output;
  }

  return next.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function upsertFacts(
  existing: SessionWorkingFact[],
  incoming: SessionWorkingFact[]
): SessionWorkingFact[] {
  const next = [...existing];
  const indexById = new Map(next.map((fact, index) => [fact.id, index]));

  for (const fact of incoming) {
    const index = indexById.get(fact.id);
    if (index == null) {
      indexById.set(fact.id, next.length);
      next.push(fact);
      continue;
    }
    next[index] = fact;
  }

  return next.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function dedupeNamedOutputs(outputs: SessionNamedOutput[]): SessionNamedOutput[] {
  const next: SessionNamedOutput[] = [];
  const indexByIdentity = new Map<string, number>();

  for (const output of outputs) {
    const identity = output.refId
      ? `${output.type}:${output.refId}`
      : `${output.type}:${output.source}:${output.value}`;
    const existingIndex = indexByIdentity.get(identity);

    if (existingIndex == null) {
      indexByIdentity.set(identity, next.length);
      next.push(output);
      continue;
    }

    const existing = next[existingIndex];
    const shouldReplace =
      existing.source === "session" && output.source !== "session"
        ? true
        : output.createdAt >= existing.createdAt;

    if (shouldReplace) {
      next[existingIndex] = output;
    }
  }

  return next.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function buildDefaultNamedOutputs(state: SessionState): SessionNamedOutput[] {
  const outputs: SessionNamedOutput[] = [];
  const latestArtifact = state.artifacts[state.artifacts.length - 1];
  const latestFile = state.generatedFiles[state.generatedFiles.length - 1];

  if (latestArtifact) {
    outputs.push({
      key: "latest_artifact",
      type: "artifact",
      label: latestArtifact.title,
      value: latestArtifact.title,
      refId: latestArtifact.id,
      source: "session",
      createdAt: latestArtifact.createdAt,
    });
  }

  if (latestFile) {
    outputs.push({
      key: "latest_generated_file",
      type: "file",
      label: latestFile.filename,
      value: latestFile.filename,
      refId: latestFile.id,
      source: "session",
      createdAt: latestFile.createdAt,
    });
  }

  return outputs;
}

function createEmptyState(sessionId: string): SessionState {
  return {
    version: 2,
    sessionId,
    latestUserMessage: null,
    attachments: [],
    artifacts: [],
    generatedFiles: [],
    namedOutputs: [],
    workingFacts: [],
    recentToolResults: [],
    recentDelegateResults: [],
    timelineTurns: [],
  };
}

function ensureTimelineTurn(
  state: SessionState,
  turnId: string,
  params: {
    createdAt: string;
    userMessage?: string;
    userMessageId?: string;
  }
): SessionTimelineTurn {
  const existing = state.timelineTurns.find((turn) => turn.id === turnId);
  if (existing) {
    if (params.userMessage !== undefined) existing.userMessage = params.userMessage;
    if (params.userMessageId) existing.userMessageId = params.userMessageId;
    return existing;
  }

  const turn: SessionTimelineTurn = {
    id: turnId,
    userMessageId: params.userMessageId,
    userMessage: params.userMessage || "",
    createdAt: params.createdAt,
    events: [],
  };
  state.timelineTurns.push(turn);
  state.timelineTurns.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return turn;
}

function getTimelineTurn(state: SessionState, turnId?: string): SessionTimelineTurn | null {
  if (!turnId) return state.timelineTurns[state.timelineTurns.length - 1] || null;
  return state.timelineTurns.find((turn) => turn.id === turnId) || null;
}

function appendTimelineEvent(
  state: SessionState,
  turnId: string,
  event: SessionTimelineEvent,
  params?: { mergeAssistantText?: boolean }
): SessionState {
  const nextState = cloneSessionState(state);
  const turn = ensureTimelineTurn(nextState, turnId, {
    createdAt: event.createdAt,
  });

  if (params?.mergeAssistantText && event.type === "assistant_text") {
    const lastEvent = turn.events[turn.events.length - 1];
    if (lastEvent?.type === "assistant_text") {
      lastEvent.content += event.content;
      return nextState;
    }
  }

  turn.events.push(event);
  return nextState;
}

function updateTimelineToolCall(
  state: SessionState,
  turnId: string,
  params: {
    toolId: string;
    toolName: string;
    status: "running" | "success" | "error";
    createdAt: string;
    input?: Record<string, unknown>;
    summary?: string;
    namedOutputs?: SessionNamedOutput[];
    facts?: SessionWorkingFact[];
    agent?: string;
    resultKind?: "tool" | "delegate";
  }
): SessionState {
  const nextState = cloneSessionState(state);
  const turn = ensureTimelineTurn(nextState, turnId, {
    createdAt: params.createdAt,
  });
  const existingEvent = turn.events.find(
    (event): event is SessionTimelineToolCallEvent =>
      event.type === "tool_call" && event.toolId === params.toolId
  );

  if (existingEvent) {
    existingEvent.status = params.status;
    existingEvent.summary = params.summary || existingEvent.summary;
    existingEvent.namedOutputs = params.namedOutputs || existingEvent.namedOutputs;
    existingEvent.facts = params.facts || existingEvent.facts;
    existingEvent.agent = params.agent || existingEvent.agent;
    existingEvent.resultKind = params.resultKind || existingEvent.resultKind;
    return nextState;
  }

  turn.events.push({
    id: params.toolId,
    type: "tool_call",
    createdAt: params.createdAt,
    toolId: params.toolId,
    toolName: params.toolName,
    status: params.status,
    input: params.input,
    summary: params.summary,
    namedOutputs: params.namedOutputs || [],
    facts: params.facts || [],
    agent: params.agent,
    resultKind: params.resultKind || "tool",
  });
  return nextState;
}

function getTurnIdForTimestamp(
  turns: SessionTimelineTurn[],
  createdAt: string
): string | null {
  if (turns.length === 0) return null;

  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index].createdAt.localeCompare(createdAt) <= 0) {
      return turns[index].id;
    }
  }

  return turns[0].id;
}

function recordTimelineArtifactFromHistory(
  state: SessionState,
  artifact: SessionArtifactState
): SessionState {
  const turnId = getTurnIdForTimestamp(state.timelineTurns, artifact.createdAt);
  if (!turnId) return state;

  const nextState = cloneSessionState(state);
  const turn = getTimelineTurn(nextState, turnId);
  if (!turn) return state;
  const exists = turn.events.some(
    (event) => event.type === "artifact" && event.artifact.id === artifact.id
  );
  if (exists) return state;

  turn.events.push({
    id: `artifact:${artifact.id}`,
    type: "artifact",
    createdAt: artifact.createdAt,
    artifact: {
      id: artifact.id,
      title: artifact.title,
      type: artifact.type,
    },
  });
  return nextState;
}

function recordTimelineFilesFromHistory(
  state: SessionState,
  files: SessionGeneratedFileState[]
): SessionState {
  if (files.length === 0) return state;
  const createdAt = files[0].createdAt;
  const turnId = getTurnIdForTimestamp(state.timelineTurns, createdAt);
  if (!turnId) return state;

  const nextState = cloneSessionState(state);
  const turn = getTimelineTurn(nextState, turnId);
  if (!turn) return state;
  const existingEvent = turn.events.find(
    (event): event is SessionTimelineFilesEvent =>
      event.type === "files" && event.files.some((file) => files.some((candidate) => candidate.id === file.id))
  );

  if (existingEvent) {
    const nextFiles = [...existingEvent.files];
    const fileIndexById = new Map(nextFiles.map((file, index) => [file.id, index]));
    for (const file of files) {
      const existingIndex = fileIndexById.get(file.id);
      if (existingIndex == null) {
        fileIndexById.set(file.id, nextFiles.length);
        nextFiles.push(file);
        continue;
      }
      nextFiles[existingIndex] = file;
    }
    existingEvent.files = nextFiles;
    return nextState;
  }

  turn.events.push({
    id: `files:${files.map((file) => file.id).join(",")}`,
    type: "files",
    createdAt,
    files,
  });
  return nextState;
}

export function createNamedOutputsForResources(params: {
  sourcePrefix: string;
  createdAt: string;
  artifact?: { id: string; title: string; type: string } | null;
  files?: Array<{ id: string; filename: string; mimeType: string; sizeBytes: number }> | null;
}): SessionNamedOutput[] {
  const outputs: SessionNamedOutput[] = [];
  const prefix = sanitizeKey(params.sourcePrefix);

  if (params.artifact) {
    outputs.push({
      key: `${prefix}_artifact`,
      type: "artifact",
      label: params.artifact.title,
      value: params.artifact.title,
      refId: params.artifact.id,
      source: params.sourcePrefix,
      createdAt: params.createdAt,
    });
  }

  for (const file of params.files || []) {
    outputs.push({
      key: `${prefix}_file_${sanitizeKey(file.filename)}`,
      type: "file",
      label: file.filename,
      value: file.filename,
      refId: file.id,
      source: params.sourcePrefix,
      createdAt: params.createdAt,
    });
  }

  return outputs;
}

export function buildSessionState(params: {
  sessionId: string;
  messages: ChatMessageRecord[];
  artifacts: ArtifactRecord[];
  files: FileRecord[];
}): SessionState {
  const state = createEmptyState(params.sessionId);

  state.artifacts = params.artifacts.map((artifact) => ({
    id: artifact.id,
    title: artifact.title,
    type: artifact.type,
    createdAt: toIsoString(artifact.createdAt),
  }));
  state.generatedFiles = params.files.map((file) => ({
    id: file.id,
    filename: file.filename,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes ?? 0,
    createdAt: toIsoString(file.createdAt),
  }));

  const attachmentById = new Map<string, SessionAttachment>();
  const assistantSegmentsByTurn = new Set<string>();
  let activeTurnId: string | null = null;

  for (const message of params.messages) {
    const createdAt = toIsoString(message.createdAt);
    const metadata = parseTimelineMetadata(message.metadata);

    if (message.role === "user" && message.content) {
      const turnId = metadata?.turnId || message.id;
      activeTurnId = turnId;
      ensureTimelineTurn(state, turnId, {
        createdAt,
        userMessage: message.content,
        userMessageId: message.id,
      });

      const parsed = parseAttachments(message.content);
      if (parsed.text) {
        state.latestUserMessage = compressMessageForModelHistory(parsed.text);
      }

      for (const attachment of parsed.attachments) {
        attachmentById.set(attachment.id, {
          id: attachment.id,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          sourceMessageId: message.id,
          createdAt,
        });
      }
      continue;
    }

    if (
      message.role !== "thinking" &&
      message.role !== "agent_status" &&
      message.role !== "tool_use" &&
      message.role !== "tool_result" &&
      message.role !== "delegate_result" &&
      message.role !== "artifact_event" &&
      message.role !== "files_event" &&
      message.role !== "assistant_segment" &&
      message.role !== "assistant"
    ) {
      continue;
    }

    const turnId = metadata?.turnId || activeTurnId;
    if (!turnId) continue;
    ensureTimelineTurn(state, turnId, { createdAt });

    if (message.role === "thinking") {
      state.timelineTurns = appendTimelineEvent(state, turnId, {
        id: `thinking:${createdAt}:${state.timelineTurns.length}`,
        type: "thinking",
        createdAt,
      }).timelineTurns;
      continue;
    }

    if (message.role === "agent_status") {
      state.timelineTurns = appendTimelineEvent(state, turnId, {
        id: `agent_status:${createdAt}:${message.id}`,
        type: "agent_status",
        createdAt,
        agent: metadata?.agent,
        content: message.content || "",
        status: getAgentStatusState(message.content || ""),
      }).timelineTurns;
      continue;
    }

    if (message.role === "assistant_segment") {
      assistantSegmentsByTurn.add(turnId);
      state.timelineTurns = appendTimelineEvent(state, turnId, {
        id: message.id,
        type: "assistant_text",
        createdAt,
        content: message.content || "",
      }, { mergeAssistantText: true }).timelineTurns;
      continue;
    }

    if (message.role === "assistant") {
      if (assistantSegmentsByTurn.has(turnId)) continue;
      state.timelineTurns = appendTimelineEvent(state, turnId, {
        id: message.id,
        type: "assistant_text",
        createdAt,
        content: message.content || "",
      }, { mergeAssistantText: true }).timelineTurns;
      continue;
    }

    if (message.role === "artifact_event" && metadata?.artifact) {
      state.timelineTurns = appendTimelineEvent(state, turnId, {
        id: `artifact:${metadata.artifact.id}:${createdAt}`,
        type: "artifact",
        createdAt,
        artifact: metadata.artifact,
      }).timelineTurns;
      continue;
    }

    if (message.role === "files_event" && metadata?.files?.length) {
      state.timelineTurns = appendTimelineEvent(state, turnId, {
        id: `files:${metadata.files.map((file) => file.id).join(",")}:${createdAt}`,
        type: "files",
        createdAt,
        files: toTimelineFiles(metadata.files, createdAt),
      }).timelineTurns;
      continue;
    }

    if (message.role === "tool_use") {
      state.timelineTurns = updateTimelineToolCall(state, turnId, {
        toolId: metadata?.toolId || message.id,
        toolName: metadata?.toolName || message.content || "tool",
        status: "running",
        createdAt,
        input: metadata?.input,
        agent: metadata?.agent,
        resultKind: metadata?.toolName === "delegate" ? "delegate" : "tool",
      }).timelineTurns;
      continue;
    }

    if (message.role === "tool_result" || message.role === "delegate_result") {
      const executionMetadata = parseExecutionMetadata(message.metadata);
      if (!executionMetadata?.toolName || typeof executionMetadata.success !== "boolean") {
        continue;
      }
      const executionSource = executionMetadata.agent || executionMetadata.toolName || "tool";

      const namedOutputs = (executionMetadata.namedOutputs || []).map((output) => ({
        ...output,
        createdAt: output.createdAt || createdAt,
      }));
      const facts = (executionMetadata.facts || []).map((fact) =>
        normalizeFact(fact, executionSource, createdAt)
      );

      state.namedOutputs = upsertNamedOutputs(state.namedOutputs, namedOutputs);
      state.workingFacts = upsertFacts(state.workingFacts, facts);

      const execution: SessionExecutionRecord = {
        toolName: executionMetadata.toolName,
        success: executionMetadata.success,
        summary: executionMetadata.summary || "",
        agent: executionMetadata.agent,
        namedOutputs,
        facts,
        createdAt,
      };

      if (message.role === "delegate_result" && executionMetadata.agent) {
        state.recentDelegateResults.push({
          agent: executionMetadata.agent,
          summary: executionMetadata.summary || "",
          namedOutputs,
          facts,
          createdAt,
        });
      } else {
        state.recentToolResults.push(execution);
      }

      state.timelineTurns = updateTimelineToolCall(state, turnId, {
        toolId: metadata?.toolId || `${executionMetadata.toolName}:${createdAt}`,
        toolName: executionMetadata.toolName,
        status: executionMetadata.success ? "success" : "error",
        createdAt,
        summary: executionMetadata.summary || "",
        namedOutputs,
        facts,
        agent: executionMetadata.agent,
        resultKind: message.role === "delegate_result" ? "delegate" : "tool",
      }).timelineTurns;
    }
  }

  state.attachments = [...attachmentById.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  state.namedOutputs = upsertNamedOutputs(state.namedOutputs, buildDefaultNamedOutputs(state));
  state.recentToolResults = state.recentToolResults.slice(-12);
  state.recentDelegateResults = state.recentDelegateResults.slice(-8);
  state.workingFacts = state.workingFacts.slice(-20);

  for (const artifact of state.artifacts) {
    state.timelineTurns = recordTimelineArtifactFromHistory(state, artifact).timelineTurns;
  }

  const filesByTimestamp = new Map<string, SessionGeneratedFileState[]>();
  for (const file of state.generatedFiles) {
    const existing = filesByTimestamp.get(file.createdAt) || [];
    existing.push(file);
    filesByTimestamp.set(file.createdAt, existing);
  }
  for (const groupedFiles of filesByTimestamp.values()) {
    state.timelineTurns = recordTimelineFilesFromHistory(state, groupedFiles).timelineTurns;
  }

  state.timelineTurns = state.timelineTurns.map((turn) => ({
    ...turn,
    events: [...turn.events].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  }));

  return state;
}

export function buildSessionStateContext(
  state: SessionState,
  options?: { heading?: string }
): string {
  const lines: string[] = [];
  const heading = options?.heading || "## Delad sessionskontext";
  const uniqueOutputs = dedupeNamedOutputs(state.namedOutputs);

  lines.push(heading);

  if (uniqueOutputs.length > 0) {
    lines.push("### Viktiga outputs");
    for (const output of uniqueOutputs.slice(-10)) {
      const ref = output.refId ? ` [ref: ${output.refId}]` : "";
      lines.push(`- ${output.key}: ${truncate(output.label, 80)} -> ${truncate(output.value, 120)}${ref}`);
    }
  }

  if (state.generatedFiles.length > 0) {
    lines.push("### Tillgängliga genererade filer");
    for (const file of state.generatedFiles.slice(-10)) {
      lines.push(`- ${file.filename} (${file.mimeType}, ${file.sizeBytes} bytes, id ${file.id})`);
    }
  }

  if (state.artifacts.length > 0) {
    lines.push("### Tillgängliga artifacts");
    for (const artifact of state.artifacts.slice(-6)) {
      lines.push(`- ${artifact.title} (${artifact.type}, id ${artifact.id})`);
    }
  }

  if (state.attachments.length > 0) {
    lines.push("### Senaste bifogade filer");
    for (const attachment of state.attachments.slice(-3)) {
      lines.push(`- ${attachment.filename} (${attachment.mimeType}, id ${attachment.id})`);
    }
  }

  if (state.workingFacts.length > 0) {
    lines.push("### Viktiga fakta från tidigare steg");
    for (const fact of state.workingFacts.slice(-10)) {
      lines.push(`- ${truncate(fact.text, 220)}`);
    }
  }

  if (state.recentDelegateResults.length > 0) {
    lines.push("### Senaste specialistöverlämningar");
    for (const delegateResult of state.recentDelegateResults.slice(-5)) {
      lines.push(`- ${delegateResult.agent}: ${truncate(delegateResult.summary, 220)}`);
    }
  }

  if (lines.length === 1) {
    return "";
  }

  return lines.join("\n");
}

export function getRoutingHint(
  userMessage: string,
  state: SessionState
): string | null {
  const text = userMessage.toLowerCase();

  if (text.includes("[redigera artifact")) {
    return "ROUTING HINT: Detta ar en artifact-redigering. Anvand create_artifact direkt eller delegera forst till artifact_designer.";
  }

  if (/(vad.*kod|vilken.*kod|vad.*query|vilken.*query|vad korde du|vad körde du|what code|show the code|show the query)/i.test(userMessage)) {
    return "ROUTING HINT: Anvand inte fler verktyg i onodan. Svara direkt utifran tidigare tool-use, query eller kod om anvandaren fragar vad som redan korts.";
  }

  if (/(pptx|powerpoint|presentation|slides|xlsx|excel|docx|word)/i.test(userMessage)) {
    return "ROUTING HINT: Anvand doc_designer tidigt for filskapande eller filredigering.";
  }

  if (/(dashboard|interaktiv|visualisering|html|artifact|artifakt)/i.test(userMessage)) {
    return "ROUTING HINT: Detta lutar mot artifact_designer eller create_artifact.";
  }

  if (
    /(diagram|graf|chart|analysera|analys|trend|prognos|jamfor|jämför)/i.test(userMessage) &&
    (state.attachments.length > 0 || state.generatedFiles.length > 0 || /(data|csv|excel|tabell)/i.test(userMessage))
  ) {
    return "ROUTING HINT: Detta lutar mot analyst for berakningar, sammanstallning och diagram.";
  }

  if (/(scb|pxweb)/i.test(userMessage)) {
    return "ROUTING HINT: Detta lutar mot api_researcher for SCB/PxWeb-anrop.";
  }

  if (/(nyheter|webben|kallor|källor|research|hitta information|sok)/i.test(userMessage)) {
    return "ROUTING HINT: Detta lutar mot web_researcher om extern informationssokning behovs.";
  }

  return null;
}

export function buildStructuredResultPayload(params: {
  type: "tool" | "delegate";
  name: string;
  success: boolean;
  summary: string;
  details?: string;
  agent?: string;
  namedOutputs?: SessionNamedOutput[];
  facts?: SessionWorkingFact[] | string[];
  artifact?: { id: string; title: string; type: string } | null;
  files?: Array<{ id: string; filename: string; mimeType: string; sizeBytes: number }> | null;
}): string {
  const facts = (params.facts || []).map((fact) =>
    typeof fact === "string" ? fact : fact.text
  );
  const details =
    typeof params.details === "string" && params.details.trim().length > 0
      ? truncate(params.details, 6000)
      : undefined;

  return JSON.stringify(
    {
      type: params.type,
      name: params.name,
      success: params.success,
      agent: params.agent,
      summary: params.summary,
      details,
      named_outputs: params.namedOutputs || [],
      facts,
      artifact: params.artifact || undefined,
      files: params.files || undefined,
    },
    null,
    2
  );
}

export function createSessionStateSnapshot(state: SessionState) {
  return {
    kind: "session_state",
    state,
  };
}

export function cloneSessionState(state: SessionState): SessionState {
  return JSON.parse(JSON.stringify(state)) as SessionState;
}

function upsertArtifact(
  artifacts: SessionArtifactState[],
  artifact: SessionArtifactState
): SessionArtifactState[] {
  const next = [...artifacts];
  const index = next.findIndex((item) => item.id === artifact.id);
  if (index === -1) {
    next.push(artifact);
  } else {
    next[index] = artifact;
  }
  return next.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function upsertGeneratedFile(
  files: SessionGeneratedFileState[],
  file: SessionGeneratedFileState
): SessionGeneratedFileState[] {
  const next = [...files];
  const index = next.findIndex((item) => item.id === file.id);
  if (index === -1) {
    next.push(file);
  } else {
    next[index] = file;
  }
  return next.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function startTurnInSessionState(
  state: SessionState,
  params: {
    turnId: string;
    userMessage: string;
    userMessageId?: string;
    createdAt: string;
  }
): SessionState {
  const nextState = cloneSessionState(state);
  ensureTimelineTurn(nextState, params.turnId, params);
  nextState.latestUserMessage = compressMessageForModelHistory(
    parseAttachments(params.userMessage).text || params.userMessage
  );
  return nextState;
}

export function appendThinkingToSessionState(
  state: SessionState,
  turnId: string,
  createdAt: string
): SessionState {
  return appendTimelineEvent(state, turnId, {
    id: `thinking:${createdAt}:${turnId}`,
    type: "thinking",
    createdAt,
  });
}

export function appendAgentStatusToSessionState(
  state: SessionState,
  turnId: string,
  params: {
    createdAt: string;
    content: string;
    agent?: string;
  }
): SessionState {
  return appendTimelineEvent(state, turnId, {
    id: `agent_status:${params.createdAt}:${params.agent || "agent"}`,
    type: "agent_status",
    createdAt: params.createdAt,
    agent: params.agent,
    content: params.content,
    status: getAgentStatusState(params.content),
  });
}

export function appendAssistantTextToSessionState(
  state: SessionState,
  turnId: string,
  text: string,
  createdAt: string
): SessionState {
  return appendTimelineEvent(state, turnId, {
    id: `assistant_text:${createdAt}:${turnId}`,
    type: "assistant_text",
    createdAt,
    content: text,
  }, { mergeAssistantText: true });
}

export function startToolCallInSessionState(
  state: SessionState,
  turnId: string,
  params: {
    toolId: string;
    toolName: string;
    createdAt: string;
    input?: Record<string, unknown>;
    agent?: string;
    resultKind?: "tool" | "delegate";
  }
): SessionState {
  return updateTimelineToolCall(state, turnId, {
    ...params,
    status: "running",
  });
}

export function applyArtifactToSessionState(
  state: SessionState,
  artifact: { id: string; title: string; type: string },
  createdAt: string,
  turnId?: string
): SessionState {
  let nextState = cloneSessionState(state);
  nextState.artifacts = upsertArtifact(nextState.artifacts, {
    id: artifact.id,
    title: artifact.title,
    type: artifact.type,
    createdAt,
  });
  nextState.namedOutputs = upsertNamedOutputs(nextState.namedOutputs, buildDefaultNamedOutputs(nextState));

  if (turnId) {
    nextState = appendTimelineEvent(nextState, turnId, {
      id: `artifact:${artifact.id}:${createdAt}`,
      type: "artifact",
      createdAt,
      artifact,
    });
  }

  return nextState;
}

export function applyFilesToSessionState(
  state: SessionState,
  files: Array<{ id: string; filename: string; mimeType: string; sizeBytes: number }>,
  createdAt: string,
  turnId?: string
): SessionState {
  let nextState = cloneSessionState(state);
  const timelineFiles = toTimelineFiles(files, createdAt);

  for (const file of timelineFiles) {
    nextState.generatedFiles = upsertGeneratedFile(nextState.generatedFiles, file);
  }

  nextState.namedOutputs = upsertNamedOutputs(nextState.namedOutputs, buildDefaultNamedOutputs(nextState));

  if (turnId) {
    nextState = appendTimelineEvent(nextState, turnId, {
      id: `files:${timelineFiles.map((file) => file.id).join(",")}:${createdAt}`,
      type: "files",
      createdAt,
      files: timelineFiles,
    });
  }

  return nextState;
}

export function applyExecutionToSessionState(
  state: SessionState,
  params: {
    kind: "tool" | "delegate";
    toolName: string;
    success: boolean;
    summary: string;
    agent?: string;
    createdAt: string;
    namedOutputs?: SessionNamedOutput[];
    facts?: SessionWorkingFact[] | string[];
    artifact?: { id: string; title: string; type: string } | null;
    files?: Array<{ id: string; filename: string; mimeType: string; sizeBytes: number }> | null;
    turnId?: string;
    toolId?: string;
  }
): SessionState {
  let nextState = cloneSessionState(state);

  if (params.artifact) {
    nextState.artifacts = upsertArtifact(nextState.artifacts, {
      id: params.artifact.id,
      title: params.artifact.title,
      type: params.artifact.type,
      createdAt: params.createdAt,
    });
  }

  for (const file of params.files || []) {
    nextState.generatedFiles = upsertGeneratedFile(nextState.generatedFiles, {
      id: file.id,
      filename: file.filename,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      createdAt: params.createdAt,
    });
  }

  const namedOutputs = params.namedOutputs || [];
  const facts = (params.facts || []).map((fact) =>
    normalizeFact(fact, params.agent || params.toolName, params.createdAt)
  );

  nextState.namedOutputs = upsertNamedOutputs(
    nextState.namedOutputs,
    upsertNamedOutputs(namedOutputs, buildDefaultNamedOutputs(nextState))
  );
  nextState.workingFacts = upsertFacts(nextState.workingFacts, facts).slice(-20);

  if (params.kind === "delegate" && params.agent) {
    nextState.recentDelegateResults = [
      ...nextState.recentDelegateResults,
      {
        agent: params.agent,
        summary: params.summary,
        namedOutputs,
        facts,
        createdAt: params.createdAt,
      },
    ].slice(-8);
  } else {
    nextState.recentToolResults = [
      ...nextState.recentToolResults,
      {
        toolName: params.toolName,
        success: params.success,
        summary: params.summary,
        agent: params.agent,
        namedOutputs,
        facts,
        createdAt: params.createdAt,
      },
    ].slice(-12);
  }

  if (params.turnId && params.toolId) {
    nextState = updateTimelineToolCall(nextState, params.turnId, {
      toolId: params.toolId,
      toolName: params.toolName,
      status: params.success ? "success" : "error",
      createdAt: params.createdAt,
      summary: params.summary,
      namedOutputs,
      facts,
      agent: params.agent,
      resultKind: params.kind,
    });
  }

  return nextState;
}
