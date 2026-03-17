"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  metadata?: Record<string, unknown>;
}

interface MessageBubbleProps {
  message: Message;
}

/**
 * Strip markdown image references so they don't render as broken images.
 * Agents may write `![chart](filename.png)` but we show images in the lightbox instead.
 */
function stripImageRefs(content: string): string {
  return content.replace(/!\[[^\]]*\]\([^)]+\)/g, "");
}

interface ParsedAttachment {
  type: string;
  filename: string;
}

/**
 * Extract attachment markers and file tags from message content.
 * Returns clean text and list of attached files for display.
 */
function extractAttachments(content: string): { text: string; attachments: ParsedAttachment[] } {
  const attachments: ParsedAttachment[] = [];

  let text = content
    // <attachment type="pdf" id="..." filename="report.pdf" />
    .replace(/<attachment\s+type="([^"]+)"\s+id="[^"]+"\s+filename="([^"]+)"(?:\s+mimeType="[^"]+")?\s*\/>/g, (_, type, filename) => {
      attachments.push({ type: type.toUpperCase(), filename });
      return "";
    })
    // <file name="data.csv" type="text/csv">...</file>
    .replace(/<file\s+name="([^"]+)"[^>]*>[\s\S]*?<\/file>/g, (_, filename) => {
      const ext = filename.split(".").pop()?.toUpperCase() || "FIL";
      attachments.push({ type: ext, filename });
      return "";
    })
    .trim();

  return { text, attachments };
}

function AttachmentBadges({ attachments }: { attachments: ParsedAttachment[] }) {
  if (attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {attachments.map((att, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 rounded-md bg-white/15 px-2 py-0.5 text-xs font-medium"
        >
          <span className="opacity-70">{att.type}</span>
          <span className="truncate max-w-[200px]">{att.filename}</span>
        </span>
      ))}
    </div>
  );
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";

  if (isUser) {
    const { text, attachments } = extractAttachments(message.content);
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] min-w-0 rounded-xl px-4 py-3 text-sm bg-primary text-primary-foreground">
          {text && <p className="whitespace-pre-wrap break-words">{text}</p>}
          <AttachmentBadges attachments={attachments} />
        </div>
      </div>
    );
  }

  const cleanContent = stripImageRefs(message.content);

  return (
    <div className="flex justify-start">
      <div className="max-w-[80%] min-w-0 rounded-xl px-4 py-3 text-sm bg-card text-card-foreground border border-border shadow-sm">
        <div className="prose prose-sm max-w-none dark:prose-invert overflow-hidden break-words [&_pre]:overflow-x-auto [&_pre]:max-w-full [&_code]:break-all [&_pre_code]:break-normal [&_table]:block [&_table]:overflow-x-auto">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {cleanContent}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
