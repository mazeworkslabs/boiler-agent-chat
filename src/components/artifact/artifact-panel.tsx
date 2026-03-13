"use client";

import { useState } from "react";

export interface Artifact {
  id: string;
  title: string;
  type: string;
  content: string;
}

interface ArtifactPanelProps {
  artifacts: Artifact[];
  onClose?: () => void;
}

const CDN_SCRIPTS = `
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<script src="https://cdn.jsdelivr.net/npm/d3@7"></script>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
`;

function CopyIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function ArtifactPanel({ artifacts, onClose }: ArtifactPanelProps) {
  const [activeTab, setActiveTab] = useState(0);
  const [copied, setCopied] = useState(false);

  if (artifacts.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p className="text-sm">Artifacts visas här</p>
      </div>
    );
  }

  const active = artifacts[activeTab];

  const iframeContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      ${CDN_SCRIPTS}
      <style>body { font-family: system-ui, sans-serif; margin: 0; padding: 16px; }</style>
    </head>
    <body>${active.content}</body>
    </html>
  `;

  const btnClass =
    "inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

  return (
    <div className="flex h-full flex-col">
      {/* Tabs */}
      {artifacts.length > 1 && (
        <div className="flex gap-1 border-b border-border p-2 overflow-x-auto">
          {artifacts.map((a, i) => (
            <button
              key={a.id}
              onClick={() => setActiveTab(i)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                i === activeTab
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {a.title}
            </button>
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <h3 className="text-sm font-medium truncate mr-3">{active.title}</h3>
        <div className="flex gap-1.5 shrink-0">
          <button
            onClick={() => {
              navigator.clipboard.writeText(active.content);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className={btnClass}
          >
            <CopyIcon />
            {copied ? "Kopierat!" : "Kopiera"}
          </button>
          <button
            onClick={() => {
              const ext = active.type === "csv" ? ".csv" : active.type === "svg" ? ".svg" : active.type === "markdown" ? ".md" : ".html";
              const mime = active.type === "csv" ? "text/csv" : active.type === "svg" ? "image/svg+xml" : active.type === "markdown" ? "text/markdown" : "text/html";
              const content = active.type === "html" ? iframeContent : active.content;
              const blob = new Blob([content], { type: mime });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `${active.title.replace(/[^a-zA-Z0-9åäöÅÄÖ _-]/g, "")}${ext}`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className={btnClass}
          >
            <DownloadIcon />
            Ladda ner
          </button>
          <button
            onClick={() => {
              const blob = new Blob([iframeContent], { type: "text/html" });
              const url = URL.createObjectURL(blob);
              window.open(url, "_blank");
            }}
            className={btnClass}
          >
            <ExternalIcon />
            Ny flik
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className={btnClass}
              title="Stäng panel"
            >
              <CloseIcon />
            </button>
          )}
        </div>
      </div>

      {/* Preview */}
      <div className="flex-1">
        <iframe
          srcDoc={iframeContent}
          className="h-full w-full border-0"
          sandbox="allow-scripts allow-same-origin"
          title={active.title}
        />
      </div>
    </div>
  );
}
