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

interface SessionStateSnapshot {
  version: number;
  attachments: Array<{ id: string }>;
  artifacts: Array<{ id: string }>;
  generatedFiles: Array<{ id: string }>;
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

export function SessionContextPanel({ state }: SessionContextPanelProps) {
  if (!state) return null;

  const latestOutputs = dedupeNamedOutputs(state.namedOutputs).slice(-4).reverse();
  const latestFacts = [...state.workingFacts].slice(-3).reverse();
  const recentDelegates = [...state.recentDelegateResults].slice(-3).reverse();
  const hasContent = latestOutputs.length > 0 || latestFacts.length > 0 || recentDelegates.length > 0;

  if (!hasContent) return null;

  return (
    <section className="rounded-2xl border border-border bg-card/85 px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Delad kontext</h3>
          <p className="text-xs text-muted-foreground">
            Samma state delas nu mellan lead-agent, specialister och nasta steg.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
          <span className="rounded-full bg-muted px-2 py-1">{state.generatedFiles.length} filer</span>
          <span className="rounded-full bg-muted px-2 py-1">{state.artifacts.length} artifacts</span>
          <span className="rounded-full bg-muted px-2 py-1">{state.attachments.length} bilagor</span>
        </div>
      </div>

      {latestOutputs.length > 0 && (
        <div className="mt-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Senaste outputs
          </p>
          <div className="flex flex-wrap gap-2">
            {latestOutputs.map((output) => {
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
                  <p className="mt-1 text-[11px] text-muted-foreground/90">Kalla: {formatLabel(output.source)}</p>
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

      {recentDelegates.length > 0 && (
        <div className="mt-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Specialistoverlamningar
          </p>
          <div className="space-y-2">
            {recentDelegates.map((delegateResult) => (
              <div key={`${delegateResult.agent}:${delegateResult.createdAt}`} className="rounded-xl border border-border bg-background/70 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-primary">
                    {formatLabel(delegateResult.agent)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-foreground">{truncate(delegateResult.summary, 180)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {latestFacts.length > 0 && (
        <div className="mt-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Viktiga fakta
          </p>
          <div className="space-y-1.5">
            {latestFacts.map((fact) => (
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
