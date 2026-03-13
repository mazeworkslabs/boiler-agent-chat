"use client";

interface GeneratedFile {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

interface FileDownloadProps {
  files: GeneratedFile[];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(mimeType: string): string {
  if (mimeType.startsWith("image/")) return "🖼️";
  if (mimeType.includes("pdf")) return "📄";
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel") || mimeType.includes("csv")) return "📊";
  if (mimeType.includes("html")) return "🌐";
  return "📎";
}

export function FileDownload({ files }: FileDownloadProps) {
  return (
    <div className="flex flex-wrap gap-2 py-1">
      {files.map((file) => (
        <a
          key={file.id}
          href={`/api/serve-file/${file.id}`}
          download={file.filename}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm transition-colors hover:bg-muted"
        >
          <span>{getFileIcon(file.mimeType)}</span>
          <span className="font-medium">{file.filename}</span>
          <span className="text-xs text-muted-foreground">{formatBytes(file.sizeBytes)}</span>
        </a>
      ))}
    </div>
  );
}
