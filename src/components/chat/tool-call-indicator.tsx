"use client";

interface ToolCallIndicatorProps {
  toolName: string;
  status: "running" | "success" | "error";
  summary?: string;
}

export function ToolCallIndicator({ toolName, status, summary }: ToolCallIndicatorProps) {
  return (
    <div className="flex items-start gap-2 py-1">
      <div className="flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-1 text-xs text-muted-foreground">
        {status === "running" && (
          <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
        )}
        {status === "success" && (
          <span className="text-green-500">&#10003;</span>
        )}
        {status === "error" && (
          <span className="text-destructive">&#10007;</span>
        )}
        <span className="font-mono">{toolName}</span>
      </div>
      {summary && (
        <span className="text-xs text-muted-foreground">{summary}</span>
      )}
    </div>
  );
}
