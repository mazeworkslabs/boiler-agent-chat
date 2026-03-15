"use client";

interface GeneratedFile {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

interface FileDownloadProps {
  files: GeneratedFile[];
  onImageClick?: (imageIndex: number) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileStyle(mimeType: string): { label: string; bg: string; text: string } {
  if (mimeType.startsWith("image/")) return { label: "IMG", bg: "bg-violet-500/10", text: "text-violet-600" };
  if (mimeType.includes("pdf")) return { label: "PDF", bg: "bg-red-500/10", text: "text-red-600" };
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel") || mimeType.includes("csv"))
    return { label: "XLS", bg: "bg-emerald-500/10", text: "text-emerald-600" };
  if (mimeType.includes("presentation") || mimeType.includes("pptx"))
    return { label: "PPT", bg: "bg-amber-500/10", text: "text-amber-600" };
  if (mimeType.includes("word") || mimeType.includes("docx"))
    return { label: "DOC", bg: "bg-blue-500/10", text: "text-blue-600" };
  if (mimeType.includes("html")) return { label: "HTML", bg: "bg-sky-500/10", text: "text-sky-600" };
  return { label: "FIL", bg: "bg-muted", text: "text-muted-foreground" };
}

export function FileDownload({ files, onImageClick }: FileDownloadProps) {
  // Separate images from other files
  const imageFiles = files.filter((f) => f.mimeType.startsWith("image/"));
  const otherFiles = files.filter((f) => !f.mimeType.startsWith("image/"));

  // Images shown newest first
  const reversedImages = [...imageFiles].reverse();

  return (
    <div className="space-y-2 py-1">
      {/* Image thumbnails — show max 3, then "+N" */}
      {reversedImages.length > 0 && (
        <div className="flex items-center gap-2">
          {reversedImages.slice(0, 3).map((file) => {
            const lightboxIndex = imageFiles.length - 1 - imageFiles.indexOf(file);
            return (
              <button
                key={file.id}
                onClick={() => onImageClick?.(lightboxIndex)}
                className="group relative overflow-hidden rounded-lg border border-border bg-muted/30 transition-all hover:border-primary/30 hover:shadow-sm"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/serve-file/${file.id}`}
                  alt={file.filename}
                  className="h-20 w-auto max-w-[140px] object-cover"
                  loading="lazy"
                />
                <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/20">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-white opacity-0 transition-opacity group-hover:opacity-100 drop-shadow-lg">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    <line x1="11" y1="8" x2="11" y2="14" />
                    <line x1="8" y1="11" x2="14" y2="11" />
                  </svg>
                </div>
              </button>
            );
          })}
          {reversedImages.length > 3 && (
            <button
              onClick={() => onImageClick?.(0)}
              className="flex h-20 w-16 items-center justify-center rounded-lg border border-border bg-muted/30 text-sm font-medium text-muted-foreground transition-all hover:border-primary/30 hover:text-foreground"
            >
              +{reversedImages.length - 3}
            </button>
          )}
        </div>
      )}

      {/* Other files — download links */}
      {otherFiles.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {otherFiles.map((file) => {
            const style = getFileStyle(file.mimeType);
            return (
              <a
                key={file.id}
                href={`/api/serve-file/${file.id}`}
                download={file.filename}
                className="group inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm transition-all hover:border-primary/30 hover:shadow-sm"
              >
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${style.bg} ${style.text}`}>
                  {style.label}
                </span>
                <span className="font-medium group-hover:text-primary transition-colors">
                  {file.filename}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatBytes(file.sizeBytes)}
                </span>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                </svg>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
