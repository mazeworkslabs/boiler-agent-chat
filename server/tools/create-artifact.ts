import { Type, type FunctionDeclaration } from "@google/genai";

const DB_UNSAFE_CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function toWellFormedText(value: string): string {
  if (typeof value.toWellFormed === "function") {
    return value.toWellFormed();
  }
  return value;
}

function sanitizeArtifactText(value: unknown): string {
  if (typeof value !== "string") return "";
  return toWellFormedText(value).replace(DB_UNSAFE_CONTROL_CHARS_RE, "");
}

export const createArtifactToolDefinition = {
  name: "create_artifact",
  description:
    "Skapa en artifact (HTML, React, SVG, Markdown, CSV) som visas i en preview-panel bredvid chatten. Använd för visualiseringar, dashboards, dokument, diagram, tabeller etc.",
  input_schema: {
    type: "object" as const,
    properties: {
      title: {
        type: "string",
        description: "Titel på artifakten",
      },
      type: {
        type: "string",
        enum: ["html", "react", "svg", "markdown", "csv"],
        description: "Typ av artifact. 'html' för fullständiga HTML-sidor med script/style.",
      },
      content: {
        type: "string",
        description:
          "Innehållet. För HTML: fullständig HTML med <html>, <head>, <body>. CDN-bibliotek (Tailwind, Chart.js, D3, Three.js, Mermaid, Recharts) injiceras automatiskt.",
      },
    },
    required: ["title", "type", "content"],
  },
};

export const createArtifactGeminiTool: FunctionDeclaration = {
  name: "create_artifact",
  description: createArtifactToolDefinition.description,
  parameters: {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING, description: "Titel på artifakten" },
      type: {
        type: Type.STRING,
        enum: ["html", "react", "svg", "markdown", "csv"],
        description: "Typ av artifact",
      },
      content: {
        type: Type.STRING,
        description:
          "Innehållet. För HTML: fullständig HTML. CDN-bibliotek injiceras automatiskt.",
      },
    },
    required: ["title", "type", "content"],
  },
};

export function executeCreateArtifact(input: Record<string, unknown>): {
  success: boolean;
  result: string;
  artifact: { id: string; title: string; type: string; content: string };
} {
  const id = crypto.randomUUID();
  const title = sanitizeArtifactText(input.title).trim() || "Untitled artifact";
  const type = sanitizeArtifactText(input.type).trim() || "html";
  const content = sanitizeArtifactText(input.content);

  return {
    success: true,
    result: `Artifact "${title}" skapad (${type}).`,
    artifact: { id, title, type, content },
  };
}
