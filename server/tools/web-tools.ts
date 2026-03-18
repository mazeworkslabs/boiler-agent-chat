import { Type, type FunctionDeclaration } from "@google/genai";
import { writeFile, mkdir, stat } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { db } from "../db";
import { generatedFiles } from "../db/schema";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

// --- web_fetch: hämta och parsa en webbsida ---

export const webFetchToolDefinition = {
  name: "web_fetch",
  description:
    "Hämta innehållet från en URL. Returnerar text-innehållet (HTML strippat till text om möjligt). Om URL:en pekar på en PDF eller annan binär fil laddas den ned och sparas automatiskt.",
  input_schema: {
    type: "object" as const,
    properties: {
      url: {
        type: "string",
        description: "URL att hämta",
      },
      extract_text: {
        type: "boolean",
        description: "Om true, extrahera bara text (strippa HTML). Default: true.",
      },
    },
    required: ["url"],
  },
};

export const webFetchGeminiTool: FunctionDeclaration = {
  name: "web_fetch",
  description:
    "Hämta innehållet från en URL. Returnerar text-innehållet (HTML strippat till text om möjligt). Om URL:en pekar på en PDF eller annan binär fil laddas den ned och sparas automatiskt.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      url: { type: Type.STRING, description: "URL att hämta" },
      extract_text: {
        type: Type.BOOLEAN,
        description: "Om true, extrahera bara text. Default: true.",
      },
    },
    required: ["url"],
  },
};

function stripHtml(html: string): string {
  // Remove script and style tags with content
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, " ");
  // Decode common entities
  text = text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
  // Collapse whitespace
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

// Binary content types that should be downloaded as files
const BINARY_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats",
  "application/vnd.ms-",
  "application/msword",
  "application/zip",
  "application/octet-stream",
  "image/",
];

function isBinaryContentType(ct: string): boolean {
  return BINARY_TYPES.some((t) => ct.includes(t));
}

function guessFilename(url: string, contentType: string): string {
  // Try to extract filename from URL path
  const urlPath = new URL(url).pathname;
  const basename = urlPath.split("/").pop() || "";
  if (basename && basename.includes(".")) return decodeURIComponent(basename);

  // Fallback based on content type
  if (contentType.includes("pdf")) return "downloaded.pdf";
  if (contentType.includes("spreadsheet") || contentType.includes("xlsx")) return "downloaded.xlsx";
  if (contentType.includes("presentation") || contentType.includes("pptx")) return "downloaded.pptx";
  if (contentType.includes("word") || contentType.includes("docx")) return "downloaded.docx";
  return "downloaded.bin";
}

function guessMimeType(filename: string, contentType: string): string {
  if (contentType && !contentType.includes("octet-stream")) return contentType.split(";")[0].trim();
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "pdf": return "application/pdf";
    case "xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "pptx": return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    default: return contentType || "application/octet-stream";
  }
}

export async function executeWebFetch(
  input: Record<string, unknown>,
  sessionId?: string
): Promise<{
  success: boolean;
  result: string;
  files?: Array<{ id: string; filename: string; mimeType: string; sizeBytes: number }>;
}> {
  const url = input.url as string;
  const extractText = input.extract_text !== false; // default true

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; BFAssistant/1.0)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(30000),
      redirect: "follow",
    });

    if (!res.ok) {
      return { success: false, result: `HTTP ${res.status}: ${res.statusText}` };
    }

    const contentType = res.headers.get("content-type") || "";

    // Handle binary files (PDFs, Office docs, etc.) — download and save
    if (isBinaryContentType(contentType) || url.toLowerCase().endsWith(".pdf")) {
      const buffer = Buffer.from(await res.arrayBuffer());
      const filename = guessFilename(url, contentType);
      const mimeType = guessMimeType(filename, contentType);
      const fileId = crypto.randomUUID();
      const ext = filename.split(".").pop() || "bin";
      const destPath = path.join(UPLOADS_DIR, `${fileId}.${ext}`);

      await mkdir(UPLOADS_DIR, { recursive: true });
      await writeFile(destPath, buffer);
      const fileStat = await stat(destPath);

      if (sessionId) {
        await db.insert(generatedFiles).values({
          id: fileId,
          sessionId,
          filename,
          mimeType,
          filePath: destPath,
          sizeBytes: fileStat.size,
        });
      }

      const fileInfo = { id: fileId, filename, mimeType, sizeBytes: fileStat.size };

      return {
        success: true,
        result: `Filen "${filename}" (${(fileStat.size / 1024).toFixed(1)} KB, ${mimeType}) laddades ned från ${url}`,
        files: [fileInfo],
      };
    }

    // Text/HTML content
    const body = await res.text();

    if (extractText && contentType.includes("text/html")) {
      const text = stripHtml(body);
      return {
        success: true,
        result: text.length > 8000 ? text.slice(0, 8000) + "\n\n... (trunkerat)" : text,
      };
    }

    // For JSON/text, return as-is (truncated)
    return {
      success: true,
      result: body.length > 8000 ? body.slice(0, 8000) + "\n\n... (trunkerat)" : body,
    };
  } catch (err) {
    return {
      success: false,
      result: err instanceof Error ? err.message : "Fetch error",
    };
  }
}

// --- web_search: sök på webben ---

export const webSearchToolDefinition = {
  name: "web_search",
  description:
    "Sök på webben efter information. Returnerar sökresultat med titlar, URLs och snippets. Använd för att hitta aktuell information, fakta, nyheter etc.",
  input_schema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "Sökfråga",
      },
    },
    required: ["query"],
  },
};

export const webSearchGeminiTool: FunctionDeclaration = {
  name: "web_search",
  description: webSearchToolDefinition.description,
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: { type: Type.STRING, description: "Sökfråga" },
    },
    required: ["query"],
  },
};

export async function executeWebSearch(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: string }> {
  const query = input.query as string;

  // Use a simple approach: fetch DuckDuckGo HTML search and extract results
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; BFAssistant/1.0)",
      },
      signal: AbortSignal.timeout(10000),
    });

    const html = await res.text();

    // Extract result snippets from DDG HTML
    const results: string[] = [];
    const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let match;
    while ((match = resultRegex.exec(html)) !== null && results.length < 8) {
      const href = match[1];
      const title = stripHtml(match[2]);
      const snippet = stripHtml(match[3]);
      results.push(`[${title}](${href})\n${snippet}`);
    }

    if (results.length === 0) {
      return { success: true, result: "Inga sökresultat hittades." };
    }

    return { success: true, result: results.join("\n\n") };
  } catch (err) {
    return {
      success: false,
      result: err instanceof Error ? err.message : "Search error",
    };
  }
}
