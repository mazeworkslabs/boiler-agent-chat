"use client";

interface ToolCallIndicatorProps {
  toolName: string;
  status: "running" | "success" | "error";
  summary?: string;
  agent?: string;
  resultKind?: "tool" | "delegate";
  namedOutputs?: Array<{
    key: string;
    type: "artifact" | "file" | "text" | "data" | "summary";
    label: string;
    value: string;
  }>;
  facts?: string[];
}

const TOOL_LABELS: Record<string, { label: string; icon: string }> = {
  query_database: { label: "Databasfråga", icon: "M4 7v10c0 2 3 4 8 4s8-2 8-4V7M4 7c0 2 3 4 8 4s8-2 8-4M4 7c0-2 3-4 8-4s8 2 8 4M4 12c0 2 3 4 8 4s8-2 8-4" },
  web_search: { label: "Webbsökning", icon: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" },
  web_fetch: { label: "Hämtar sida", icon: "M12 21a9 9 0 100-18 9 9 0 000 18zM3.6 9h16.8M3.6 15h16.8M12 3a15 15 0 014 18M12 3a15 15 0 00-4 18" },
  browse_web: { label: "Webbläsare", icon: "M12 21a9 9 0 100-18 9 9 0 000 18zM3.6 9h16.8M3.6 15h16.8M12 3a15 15 0 014 18M12 3a15 15 0 00-4 18" },
  run_code: { label: "Kör kod", icon: "M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
  create_artifact: { label: "Skapar artifact", icon: "M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" },
  delegate: { label: "Specialist", icon: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 7a4 4 0 100-8 4 4 0 000 8M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" },
};

function formatLabel(value: string): string {
  return value.replace(/_/g, " ");
}

function outputTone(type: NonNullable<ToolCallIndicatorProps["namedOutputs"]>[number]["type"]): string {
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

export function ToolCallIndicator({
  toolName,
  status,
  summary,
  agent,
  resultKind,
  namedOutputs,
  facts,
}: ToolCallIndicatorProps) {
  const tool = TOOL_LABELS[toolName] || { label: toolName, icon: "M13 10V3L4 14h7v7l9-11h-7z" };
  const title = resultKind === "delegate" && agent ? `Specialist: ${formatLabel(agent)}` : tool.label;
  const visibleOutputs = namedOutputs?.slice(0, 3) || [];
  const visibleFacts = facts?.slice(0, 2) || [];
  const containerClass =
    status === "running"
      ? "border-primary/20 bg-primary/5"
      : status === "success"
        ? "border-emerald-500/20 bg-emerald-500/5"
        : "border-destructive/20 bg-destructive/5";

  return (
    <div className={`rounded-xl border px-3 py-2 shadow-sm ${containerClass}`}>
      <div className="flex flex-wrap items-center gap-2">
        <div
          className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
          status === "running"
            ? "bg-primary/10 text-primary"
            : status === "success"
              ? "bg-emerald-500/10 text-emerald-600"
              : "bg-destructive/10 text-destructive"
          }`}
        >
          {status === "running" ? (
            <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={2} className="opacity-25" />
              <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
              <path d={tool.icon} />
            </svg>
          )}
          <span>{title}</span>
        </div>
        {agent && resultKind !== "delegate" && (
          <span className="text-xs text-muted-foreground">via {formatLabel(agent)}</span>
        )}
      </div>

      {summary && status !== "running" && (
        <p className="mt-2 text-sm text-foreground">{summary}</p>
      )}

      {visibleOutputs.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {visibleOutputs.map((output) => (
            <span
              key={output.key}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${outputTone(output.type)}`}
            >
              <span className="uppercase">{output.type}</span>
              <span>{output.label}</span>
            </span>
          ))}
        </div>
      )}

      {visibleFacts.length > 0 && (
        <div className="mt-2 space-y-1">
          {visibleFacts.map((fact) => (
            <p key={fact} className="text-xs text-muted-foreground">
              {fact}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
