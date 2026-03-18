"use client";

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
    case "artifact":
      return "bg-sky-500/10 text-sky-700";
    case "file":
      return "bg-emerald-500/10 text-emerald-700";
    case "data":
      return "bg-amber-500/10 text-amber-700";
    case "summary":
      return "bg-violet-500/10 text-violet-700";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function fileIcon(mime: string): string {
  if (mime.startsWith("image/")) return "IMG";
  if (mime.includes("pdf")) return "PDF";
  if (mime.includes("spreadsheet") || mime.includes("xlsx")) return "XLS";
  if (mime.includes("presentation") || mime.includes("pptx")) return "PPT";
  if (mime.includes("word") || mime.includes("docx")) return "DOC";
  return "FIL";
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SessionContextPanel({ state }: SessionContextPanelProps) {
  if (!state) return null;

  const allOutputs = dedupeNamedOutputs(state.namedOutputs);
  const allFacts = [...state.workingFacts];
  const allDelegates = [...state.recentDelegateResults];
  const hasContent =
    allOutputs.length > 0 ||
    allFacts.length > 0 ||
    allDelegates.length > 0 ||
    state.generatedFiles.length > 0 ||
    state.attachments.length > 0;

  if (!hasContent) return null;

  // Build a set of file IDs already shown via namedOutputs to avoid duplicates
  const outputFileIds = new Set(allOutputs.filter((o) => o.type === "file" && o.refId).map((o) => o.refId));

  // Files not already in namedOutputs
  const extraFiles = state.generatedFiles.filter((f) => !outputFileIds.has(f.id));

  return (
    <section className="space-y-4">
      {/* Summary badges */}
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

      {/* Attachments (user uploads) */}
      {state.attachments.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Bilagor
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
                <span className="rounded bg-amber-500/10 px-1 py-0.5 text-[10px] font-bold text-amber-700">
                  {att.mimeType ? fileIcon(att.mimeType) : "FIL"}
                </span>
                <span className="font-medium text-foreground">{att.filename || att.id.slice(0, 8)}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Named outputs (all, not sliced) */}
      {allOutputs.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Outputs
          </p>
          <div className="flex flex-wrap gap-2">
            {allOutputs.map((output) => {
              const isFile = output.type === "file" && output.refId;
              const inner = (
                <div className={`rounded-xl border border-border bg-background/70 px-3 py-2 ${isFile ? "hover:border-primary/30 cursor-pointer transition-colors" : ""}`}>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${outputTone(output.type)}`}>
                      {output.type}
                    </span>
                    <span className="text-xs font-medium text-foreground">{truncate(output.label, 42)}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{truncate(output.value, 72)}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground/90">Källa: {formatLabel(output.source)}</p>
                </div>
              );
              return isFile ? (
                <a key={output.key} href={`/api/serve-file/${output.refId}`} target="_blank" rel="noopener noreferrer" download>
                  {inner}
                </a>
              ) : (
                <div key={output.key}>{inner}</div>
              );
            })}
          </div>
        </div>
      )}

      {/* Extra generated files not in namedOutputs */}
      {extraFiles.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Genererade filer
          </p>
          <div className="flex flex-wrap gap-2">
            {extraFiles.map((file) => (
              <a
                key={file.id}
                href={`/api/serve-file/${file.id}`}
                target="_blank"
                rel="noopener noreferrer"
                download={file.filename}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background/70 px-2.5 py-1.5 text-xs hover:border-primary/30 transition-colors"
              >
                <span className={`rounded px-1 py-0.5 text-[10px] font-bold ${
                  file.mimeType?.startsWith("image/") ? "bg-sky-500/10 text-sky-700" : "bg-emerald-500/10 text-emerald-700"
                }`}>
                  {file.mimeType ? fileIcon(file.mimeType) : "FIL"}
                </span>
                <span className="max-w-[200px] truncate font-medium text-foreground">{file.filename || file.id.slice(0, 8)}</span>
                {file.sizeBytes != null && (
                  <span className="text-muted-foreground">{formatBytes(file.sizeBytes)}</span>
                )}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Delegate summaries */}
      {allDelegates.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Specialistöverlämningar
          </p>
          <div className="space-y-2">
            {allDelegates.map((delegateResult) => (
              <div key={`${delegateResult.agent}:${delegateResult.createdAt}`} className="rounded-xl border border-border bg-background/70 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-primary">
                    {formatLabel(delegateResult.agent)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-foreground">{truncate(delegateResult.summary, 240)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Working facts */}
      {allFacts.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Viktiga fakta
          </p>
          <div className="space-y-1.5">
            {allFacts.map((fact) => (
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
