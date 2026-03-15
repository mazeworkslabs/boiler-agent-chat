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
  // Remove markdown images: ![alt](src)
  return content.replace(/!\[[^\]]*\]\([^)]+\)/g, "");
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";

  const cleanContent = isUser ? message.content : stripImageRefs(message.content);

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] min-w-0 rounded-xl px-4 py-3 text-sm ${
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-card text-card-foreground border border-border shadow-sm"
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        ) : (
          <div className="prose prose-sm max-w-none dark:prose-invert overflow-hidden break-words [&_pre]:overflow-x-auto [&_pre]:max-w-full [&_code]:break-all [&_pre_code]:break-normal [&_table]:block [&_table]:overflow-x-auto">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {cleanContent}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
