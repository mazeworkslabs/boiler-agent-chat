"use client";

import { useState } from "react";

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

interface GeneratedFileRef {
  id: string;
  filename?: string;
  mimeType?: string;
  sizeBytes?: number;
  createdAt?: string;
}

interface AttachmentRef {
  id: string;
  filename?: string;
  mimeType?: string;
}

interface SessionStateSnapshot {
  version: number;
  attachments: AttachmentRef[];
  artifacts: Array<{ id: string; title?: string; type?: string }>;
  generatedFiles: GeneratedFileRef[];
  namedOutputs: SessionNamedOutput[];
  workingFacts: SessionWorkingFact[];
  recentDelegateResults: SessionDelegateResult[];
}

interface SessionContextPanelProps {
  state: SessionStateSnapshot | null;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}...`;
}

function formatLabel(value: string): string {
  return value.replace(/_/g, " ");
}

function outputTone(type: SessionNamedOutput["type"]): string {
  switch (type) {
    case "artifact": return "bg-sky-500/10 text-sky-700";
    case "file": return "bg-emerald-500/10 text-emerald-700";
    case "data": return "bg-amber-500/10 text-amber-700";
    case "summary": return "bg-violet-500/10 text-violet-700";
    default: return "bg-muted text-muted-foreground";
  }
}

function fileTypeLabel(mime: string): string {
  if (mime.startsWith("image/")) return "Bild";
  if (mime.includes("pdf")) return "PDF";
  if (mime.includes("spreadsheet") || mime.includes("xlsx")) return "Excel";
  if (mime.includes("presentation") || mime.includes("pptx")) return "PowerPoint";
  if (mime.includes("word") || mime.includes("docx")) return "Word";
  return "Fil";
}

function fileIcon(mime: string): string {
  if (mime.startsWith("image/")) return "IMG";
  if (mime.includes("pdf")) return "PDF";
  if (mime.includes("spreadsheet") || mime.includes("xlsx")) return "XLS";
  if (mime.includes("presentation") || mime.includes("pptx")) return "PPT";
  if (mime.includes("word") || mime.includes("docx")) return "DOC";
  return "FIL";
}

function fileIconColor(mime: string): string {
  if (mime.startsWith("image/")) return "bg-sky-500/10 text-sky-700";
  if (mime.includes("pdf")) return "bg-red-500/10 text-red-700";
  if (mime.includes("spreadsheet") || mime.includes("xlsx")) return "bg-emerald-500/10 text-emerald-700";
  if (mime.includes("presentation") || mime.includes("pptx")) return "bg-amber-500/10 text-amber-700";
  if (mime.includes("word") || mime.includes("docx")) return "bg-blue-500/10 text-blue-700";
  return "bg-muted text-muted-foreground";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

// Group files by type category, sorted chronologically within each group
interface FileItem {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes?: number;
  source?: string;
  createdAt: string;
}

function groupFilesByType(files: FileItem[]): { label: string; files: FileItem[] }[] {
  const groups = new Map<string, FileItem[]>();
  const order: string[] = [];

  for (const file of files) {
    const label = fileTypeLabel(file.mimeType);
    if (!groups.has(label)) {
      groups.set(label, []);
      order.push(label);
    }
    groups.get(label)!.push(file);
  }

  // Sort each group chronologically (newest first)
  for (const group of groups.values()) {
    group.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  return order.map((label) => ({ label, files: groups.get(label)! }));
}

export function SessionContextPanel({ state }: SessionContextPanelProps) {
  const [filter, setFilter] = useState<"all" | "latest">("latest");

  if (!state) return null;

  const allOutputs = dedupeNamedOutputs(state.namedOutputs);
  const allDelegates = [...state.recentDelegateResults];
  const allFacts = [...state.workingFacts];

  const hasContent =
    allOutputs.length > 0 ||
    allFacts.length > 0 ||
    allDelegates.length > 0 ||
    state.generatedFiles.length > 0 ||
    state.attachments.length > 0;

  if (!hasContent) return null;

  // Determine "latest" cutoff — last delegate's createdAt or last output's createdAt
  const latestTimestamps = [
    ...allDelegates.map((d) => d.createdAt),
    ...allOutputs.map((o) => o.createdAt),
  ].sort();
  const latestCutoff = latestTimestamps.length > 0
    ? latestTimestamps[Math.max(0, latestTimestamps.length - 3)] // last 3 events
    : "";

  // Build unified file list from namedOutputs (file type) + generatedFiles
  const outputFileIds = new Set(allOutputs.filter((o) => o.type === "file" && o.refId).map((o) => o.refId));

  const allFiles: FileItem[] = [
    // Files from named outputs
    ...allOutputs
      .filter((o) => o.type === "file" && o.refId)
      .map((o) => ({
        id: o.refId!,
        filename: o.label || o.value,
        mimeType: guessMimeFromFilename(o.label || o.value),
        source: o.source,
        createdAt: o.createdAt,
      })),
    // Extra generated files not in named outputs
    ...state.generatedFiles
      .filter((f) => !outputFileIds.has(f.id))
      .map((f) => ({
        id: f.id,
        filename: f.filename || f.id.slice(0, 8),
        mimeType: f.mimeType || "application/octet-stream",
        sizeBytes: f.sizeBytes,
        createdAt: f.createdAt || "",
      })),
  ];

  // Non-file outputs (data, summary, text, artifact)
  const nonFileOutputs = allOutputs.filter((o) => o.type !== "file");

  // Apply filter
  const filteredFiles = filter === "latest" && latestCutoff
    ? allFiles.filter((f) => f.createdAt >= latestCutoff || !f.createdAt)
    : allFiles;

  const filteredNonFileOutputs = filter === "latest" && latestCutoff
    ? nonFileOutputs.filter((o) => o.createdAt >= latestCutoff)
    : nonFileOutputs;

  const filteredDelegates = filter === "latest"
    ? allDelegates.slice(-2)
    : allDelegates;

  const filteredFacts = filter === "latest"
    ? allFacts.slice(-3)
    : allFacts;

  const fileGroups = groupFilesByType(filteredFiles);

  return (
    <section className="space-y-4">
      {/* Filter toggle */}
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
          {state.generatedFiles.length > 0 && (
            <span className="rounded-full bg-muted px-2 py-1">{state.generatedFiles.length} filer</span>
          )}
          {state.artifacts.length > 0 && (
            <span className="rounded-full bg-muted px-2 py-1">{state.artifacts.length} artifacts</span>
          )}
          {state.attachments.length > 0 && (
            <span className="rounded-full bg-muted px-2 py-1">{state.attachments.length} bilagor</span>
          )}
        </div>
        <div className="flex rounded-lg border border-border bg-background text-[11px]">
          <button
            onClick={() => setFilter("latest")}
            className={`px-2.5 py-1 rounded-l-lg transition-colors ${
              filter === "latest" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Senaste
          </button>
          <button
            onClick={() => setFilter("all")}
            className={`px-2.5 py-1 rounded-r-lg transition-colors ${
              filter === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Alla
          </button>
        </div>
      </div>

      {/* Attachments (user uploads) — always shown */}
      {state.attachments.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Uppladdade bilagor
          </p>
          <div className="flex flex-wrap gap-2">
            {state.attachments.map((att) => (
              <a
                key={att.id}
                href={`/api/serve-file/${att.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background/70 px-2.5 py-1.5 text-xs hover:border-primary/30 transition-colors"
              >
                <span className={`rounded px-1 py-0.5 text-[10px] font-bold ${att.mimeType ? fileIconColor(att.mimeType) : "bg-muted text-muted-foreground"}`}>
                  {att.mimeType ? fileIcon(att.mimeType) : "FIL"}
                </span>
                <span className="max-w-[200px] truncate font-medium text-foreground">{att.filename || att.id.slice(0, 8)}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Files grouped by type */}
      {fileGroups.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Genererade filer
          </p>
          <div className="space-y-3">
            {fileGroups.map((group) => (
              <div key={group.label}>
                <p className="mb-1.5 text-[10px] font-medium text-muted-foreground/80">{group.label} ({group.files.length})</p>
                <div className="flex flex-wrap gap-1.5">
                  {group.files.map((file) => (
                    <a
                      key={file.id}
                      href={`/api/serve-file/${file.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      download={file.filename}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background/70 px-2.5 py-1.5 text-xs hover:border-primary/30 transition-colors"
                    >
                      <span className={`rounded px-1 py-0.5 text-[10px] font-bold ${fileIconColor(file.mimeType)}`}>
                        {fileIcon(file.mimeType)}
                      </span>
                      <span className="max-w-[180px] truncate font-medium text-foreground">{file.filename}</span>
                      {file.sizeBytes != null && (
                        <span className="text-muted-foreground">{formatBytes(file.sizeBytes)}</span>
                      )}
                      {file.source && (
                        <span className="text-muted-foreground/70">{formatLabel(file.source)}</span>
                      )}
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Non-file outputs (data, summaries, etc.) */}
      {filteredNonFileOutputs.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Data &amp; sammanfattningar
          </p>
          <div className="flex flex-wrap gap-2">
            {filteredNonFileOutputs.map((output) => (
              <div key={output.key} className="rounded-xl border border-border bg-background/70 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${outputTone(output.type)}`}>
                    {output.type}
                  </span>
                  <span className="text-xs font-medium text-foreground">{truncate(output.label, 42)}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{truncate(output.value, 72)}</p>
                <p className="mt-1 text-[11px] text-muted-foreground/90">Källa: {formatLabel(output.source)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Delegate summaries */}
      {filteredDelegates.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Specialistöverlämningar
          </p>
          <div className="space-y-2">
            {filteredDelegates.map((d) => (
              <div key={`${d.agent}:${d.createdAt}`} className="rounded-xl border border-border bg-background/70 px-3 py-2">
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-primary">
                  {formatLabel(d.agent)}
                </span>
                <p className="mt-1 text-sm text-foreground">{truncate(d.summary, 240)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Working facts */}
      {filteredFacts.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Viktiga fakta
          </p>
          <div className="space-y-1.5">
            {filteredFacts.map((fact) => (
              <div key={fact.id} className="rounded-xl bg-muted/60 px-3 py-2 text-sm text-foreground">
                {truncate(fact.text, 180)}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function guessMimeFromFilename(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "pdf": return "application/pdf";
    case "png": return "image/png";
    case "jpg": case "jpeg": return "image/jpeg";
    case "xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "pptx": return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    default: return "application/octet-stream";
  }
}
