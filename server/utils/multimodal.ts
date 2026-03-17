/**
 * Multimodal message utilities.
 *
 * Parses <attachment /> markers embedded in message text and converts them
 * to native multimodal parts for Gemini and Anthropic APIs.
 *
 * Supported attachment types: pdf, image
 */

import { readFileSync } from "fs";
import path from "path";
import type { Part } from "@google/genai";
import type Anthropic from "@anthropic-ai/sdk";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

// Matches: <attachment type="pdf" id="uuid" filename="name.pdf" />
// or:      <attachment type="image" id="uuid" filename="photo.png" mimeType="image/png" />
const ATTACHMENT_RE =
  /<attachment\s+type="([^"]+)"\s+id="([^"]+)"\s+filename="([^"]+)"(?:\s+mimeType="([^"]+)")?\s*\/>/g;
const FILE_BLOCK_RE = /<file\s+name="([^"]+)"[^>]*>[\s\S]*?<\/file>/g;
const EXISTING_ARTIFACT_RE = /<existing-artifact(?:\s+type="([^"]+)")?>[\s\S]*?<\/existing-artifact>/g;

interface ParsedAttachment {
  type: "pdf" | "image";
  id: string;
  filename: string;
  mimeType: string;
}

/**
 * Extract attachment markers from message text.
 * Returns the cleaned text (markers removed) and parsed attachments.
 */
export function parseAttachments(content: string): {
  text: string;
  attachments: ParsedAttachment[];
} {
  const attachments: ParsedAttachment[] = [];

  const text = content.replace(ATTACHMENT_RE, (_, type, id, filename, mimeType) => {
    const ext = path.extname(filename).toLowerCase();

    if (type === "pdf") {
      attachments.push({ type: "pdf", id, filename, mimeType: "application/pdf" });
    } else if (type === "image") {
      const mime =
        mimeType ||
        (ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/webp");
      attachments.push({ type: "image", id, filename, mimeType: mime });
    }
    return ""; // Remove marker from text
  });

  return { text: text.trim(), attachments };
}

/**
 * Read an uploaded file as base64 string.
 */
function readFileBase64(id: string, filename: string): string | null {
  try {
    const ext = path.extname(filename) || "";
    const filePath = path.join(UPLOADS_DIR, `${id}${ext}`);
    return readFileSync(filePath).toString("base64");
  } catch (err) {
    console.error(`[Multimodal] Failed to read file ${id} (${filename}):`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

/**
 * Convert a message content string (potentially with attachment markers)
 * into Gemini Part[]. PDFs and images become inlineData parts.
 */
export function buildGeminiParts(content: string): Part[] {
  const { text, attachments } = parseAttachments(content);
  const parts: Part[] = [];

  if (text) {
    parts.push({ text });
  }

  for (const att of attachments) {
    const data = readFileBase64(att.id, att.filename);
    if (data) {
      parts.push({
        inlineData: {
          mimeType: att.mimeType,
          data,
        },
      });
      // Add a text hint so the model knows what the file is
      parts.push({ text: `[Bifogad fil: ${att.filename}]` });
    } else {
      parts.push({ text: `[Kunde inte läsa bifogad fil: ${att.filename}]` });
    }
  }

  // Ensure at least one part
  if (parts.length === 0) {
    parts.push({ text: "" });
  }

  return parts;
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

type AnthropicContentBlock = Anthropic.ContentBlockParam;

/**
 * Convert a message content string into Anthropic content blocks.
 * PDFs become document blocks, images become image blocks.
 * Returns plain string if no attachments found (more efficient).
 */
export function buildAnthropicContent(
  content: string
): string | AnthropicContentBlock[] {
  const { text, attachments } = parseAttachments(content);

  if (attachments.length === 0) {
    return content; // No attachments, return as plain string
  }

  const blocks: AnthropicContentBlock[] = [];

  if (text) {
    blocks.push({ type: "text", text });
  }

  for (const att of attachments) {
    const data = readFileBase64(att.id, att.filename);
    if (!data) {
      blocks.push({ type: "text", text: `[Kunde inte läsa bifogad fil: ${att.filename}]` });
      continue;
    }

    if (att.type === "pdf") {
      blocks.push({
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data,
        },
      } as AnthropicContentBlock);
    } else if (att.type === "image") {
      blocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: att.mimeType as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
          data,
        },
      });
    }
  }

  return blocks;
}

/**
 * Check if a message content string contains any attachment markers.
 */
export function hasAttachments(content: string): boolean {
  ATTACHMENT_RE.lastIndex = 0;
  return ATTACHMENT_RE.test(content);
}

export function hasEmbeddedPayloads(content: string): boolean {
  ATTACHMENT_RE.lastIndex = 0;
  FILE_BLOCK_RE.lastIndex = 0;
  EXISTING_ARTIFACT_RE.lastIndex = 0;
  return ATTACHMENT_RE.test(content) || FILE_BLOCK_RE.test(content) || EXISTING_ARTIFACT_RE.test(content);
}

export function compressMessageForModelHistory(content: string): string {
  const attachmentLabels: string[] = [];

  const textWithoutAttachments = content.replace(
    ATTACHMENT_RE,
    (_, type, _id, filename) => {
      attachmentLabels.push(
        type === "pdf"
          ? `[Tidigare bifogad PDF: ${filename}]`
          : `[Tidigare bifogad bild: ${filename}]`
      );
      return "";
    }
  );

  const textWithoutFiles = textWithoutAttachments.replace(
    FILE_BLOCK_RE,
    (_, filename) => {
      attachmentLabels.push(`[Tidigare bifogad fil: ${filename}]`);
      return "";
    }
  );

  const textWithoutArtifacts = textWithoutFiles.replace(
    EXISTING_ARTIFACT_RE,
    (_, type) => `[Tidigare artifact-innehall bifogat${type ? ` (${type})` : ""}]`
  );

  return [textWithoutArtifacts.trim(), ...attachmentLabels].filter(Boolean).join("\n\n");
}
