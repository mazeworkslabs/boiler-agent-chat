"use client";

import { useState, useRef, useEffect, useCallback } from "react";

const MODELS = {
  gemini: [
    { id: "gemini-3-flash-preview", label: "Gemini 3 Flash" },
    { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" },
    { id: "gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash Lite" },
  ],
  anthropic: [
    { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
  ],
} as const;

export interface AttachedFile {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

interface ChatInputProps {
  onSend: (message: string, provider: string, model: string, files?: AttachedFile[]) => void;
  disabled?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(mime: string): string {
  if (mime.startsWith("image/")) return "img";
  if (mime.includes("pdf")) return "PDF";
  if (mime.includes("spreadsheet") || mime.includes("csv")) return "XLS";
  if (mime.includes("presentation") || mime.includes("pptx")) return "PPT";
  if (mime.includes("word") || mime.includes("docx")) return "DOC";
  return "FIL";
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [value, setValue] = useState("");
  const [provider, setProvider] = useState<"gemini" | "anthropic">("gemini");
  const [model, setModel] = useState<string>(MODELS.gemini[0].id);
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [value]);

  const handleProviderChange = (newProvider: "gemini" | "anthropic") => {
    setProvider(newProvider);
    setModel(MODELS[newProvider][0].id);
  };

  const uploadFiles = useCallback(async (fileList: File[]) => {
    if (fileList.length === 0) return;
    setUploading(true);
    try {
      const formData = new FormData();
      for (const f of fileList) {
        formData.append("files", f);
      }
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      setFiles((prev) => [...prev, ...data.files]);
    } catch (err) {
      console.error("Upload error:", err);
    } finally {
      setUploading(false);
    }
  }, []);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if ((!trimmed && files.length === 0) || disabled) return;
    onSend(trimmed || "(Se bifogade filer)", provider, model, files.length > 0 ? files : undefined);
    setValue("");
    setFiles([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Cmd+V paste handler for images/files
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const pastedFiles: File[] = [];
    for (const item of items) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) pastedFiles.push(file);
      }
    }
    if (pastedFiles.length > 0) {
      e.preventDefault();
      uploadFiles(pastedFiles);
    }
  }, [uploadFiles]);

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length > 0) {
      uploadFiles(droppedFiles);
    }
  }, [uploadFiles]);

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const currentModels = MODELS[provider];

  return (
    <div
      className={`border-t border-border bg-card p-4 transition-colors ${dragOver ? "bg-primary/5 border-primary" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        {/* Provider & model selects */}
        <div className="flex items-center gap-2">
          <select
            value={provider}
            onChange={(e) => handleProviderChange(e.target.value as "gemini" | "anthropic")}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="gemini">Gemini</option>
            <option value="anthropic">Claude</option>
          </select>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {currentModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {/* Attached files */}
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {files.map((f) => (
              <div
                key={f.id}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/50 px-2.5 py-1 text-xs"
              >
                <span className="rounded bg-primary/10 px-1 py-0.5 text-[10px] font-bold text-primary">
                  {fileIcon(f.mimeType)}
                </span>
                <span className="max-w-[150px] truncate font-medium">{f.filename}</span>
                <span className="text-muted-foreground">{formatBytes(f.sizeBytes)}</span>
                <button
                  onClick={() => removeFile(f.id)}
                  className="ml-0.5 text-muted-foreground hover:text-foreground"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Input row */}
        <div className="flex items-end gap-2">
          {/* File upload button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || uploading}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-input text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            title="Bifoga fil"
          >
            {uploading ? (
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={2} className="opacity-25" />
                <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
              </svg>
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const selected = Array.from(e.target.files || []);
              if (selected.length > 0) uploadFiles(selected);
              e.target.value = "";
            }}
          />

          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={dragOver ? "Släpp filer här..." : "Skriv ett meddelande..."}
            disabled={disabled}
            rows={1}
            className="flex-1 resize-none rounded-xl border border-input bg-background px-4 py-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          />
          <button
            onClick={handleSubmit}
            disabled={disabled || (!value.trim() && files.length === 0)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-colors duration-200 hover:opacity-90 disabled:opacity-50"
            aria-label="Skicka meddelande"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
            >
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Drag overlay hint */}
        {dragOver && (
          <div className="text-center text-xs text-primary font-medium py-1">
            Släpp för att bifoga
          </div>
        )}
      </div>
    </div>
  );
}
