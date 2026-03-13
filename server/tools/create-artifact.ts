import { Type, type FunctionDeclaration } from "@google/genai";

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
  const title = input.title as string;
  const type = input.type as string;
  const content = input.content as string;

  return {
    success: true,
    result: `Artifact "${title}" skapad (${type}).`,
    artifact: { id, title, type, content },
  };
}
