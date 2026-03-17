import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI, type Content, type Part } from "@google/genai";
import { loadSkills, buildSkillContext, type Skill } from "./skill-loader";
import { buildGeminiParts, buildAnthropicContent } from "./utils/multimodal";
import {
  queryDatabase,
  queryDatabaseToolDefinition,
  queryDatabaseGeminiTool,
} from "./tools/query-database";
import {
  createArtifactToolDefinition,
  createArtifactGeminiTool,
  executeCreateArtifact,
} from "./tools/create-artifact";
import {
  runCodeToolDefinition,
  runCodeGeminiTool,
  executeRunCode,
} from "./tools/run-code";
import {
  webFetchToolDefinition,
  webFetchGeminiTool,
  executeWebFetch,
  webSearchToolDefinition,
  webSearchGeminiTool,
  executeWebSearch,
} from "./tools/web-tools";
import {
  browseWebToolDefinition,
  browseWebGeminiTool,
  executeBrowseWeb,
} from "./tools/browse-web";
import path from "path";

export type LLMProvider = "anthropic" | "gemini";

export const GEMINI_MODELS = [
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash" },
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" },
  { id: "gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash Lite" },
] as const;

export const ANTHROPIC_MODELS = [
  { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
] as const;

export const DEFAULT_GEMINI_MODEL = GEMINI_MODELS[0].id;
export const DEFAULT_ANTHROPIC_MODEL = ANTHROPIC_MODELS[0].id;

export interface LLMStreamEvent {
  type: "thinking" | "text_delta" | "tool_use" | "tool_result" | "done" | "error" | "artifact" | "files" | "agent_status";
  content?: string;
  toolName?: string;
  toolId?: string;
  input?: Record<string, unknown>;
  success?: boolean;
  summary?: string;
  cost?: { inputTokens: number; outputTokens: number };
  message?: string;
  // Artifact fields
  id?: string;
  title?: string;
  artifactType?: string;
  // File fields
  files?: Array<{ id: string; filename: string; mimeType: string; sizeBytes: number }>;
  // Agent team fields
  agent?: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// Load skills once at startup
const PROJECT_ROOT = path.resolve(process.cwd());
let cachedSkills: Skill[] | null = null;

function getSkills(): Skill[] {
  if (!cachedSkills) {
    cachedSkills = loadSkills(PROJECT_ROOT);
    console.log(`[Skills] Loaded ${cachedSkills.length} skills: ${cachedSkills.map((s) => s.name).join(", ")}`);
  }
  return cachedSkills;
}

function getSystemPrompt(): string {
  const skills = getSkills();
  const skillContext = buildSkillContext(skills);

  return `Du är en AI-assistent för Business Falkenberg. Du hjälper medarbetare med:
- Research och informationssökning
- Dokumentskapande (Word, PDF, presentationer)
- Dataanalys och visualisering
- Kodning och automation
- Kommunikation och texter

Du har tillgång till verktyg för att:
- Fråga Business Falkenbergs databaser (query_database)
- Skapa visuella artifacts som visas i en panel bredvid chatten (create_artifact) — använd för HTML, diagram, dashboards, tabeller
- Köra Python-kod med pandas, matplotlib, requests m.fl. (run_code)
- Söka på webben (web_search) och hämta webbsidor (web_fetch)

När användaren ber om visualiseringar, diagram, dashboards eller liknande — använd ALLTID create_artifact med type "html" och skapa en komplett HTML-sida. CDN-bibliotek (Tailwind, Chart.js, D3, Three.js, Mermaid) är tillgängliga i artifact-preview.

Svara alltid på svenska om inte användaren skriver på annat språk.
Var professionell, koncis och hjälpsam.
${skillContext}`;
}

// All Anthropic tool definitions
const ANTHROPIC_TOOLS = [
  queryDatabaseToolDefinition,
  createArtifactToolDefinition,
  runCodeToolDefinition,
  webFetchToolDefinition,
  webSearchToolDefinition,
  browseWebToolDefinition,
];

// All Gemini tool definitions
const GEMINI_FUNCTION_DECLARATIONS = [
  queryDatabaseGeminiTool,
  createArtifactGeminiTool,
  runCodeGeminiTool,
  webFetchGeminiTool,
  webSearchGeminiTool,
  browseWebGeminiTool,
];

// --- Tool execution ---

export interface ToolResult {
  success: boolean;
  result: string;
  artifact?: { id: string; title: string; type: string; content: string };
  files?: Array<{ id: string; filename: string; mimeType: string; sizeBytes: number }>;
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  sessionId?: string
): Promise<ToolResult> {
  try {
    switch (name) {
      case "query_database": {
        const { rows, rowCount } = await queryDatabase(
          input.database as string,
          input.query as string
        );
        const resultStr =
          rowCount === 0
            ? "Inga resultat."
            : JSON.stringify(rows.slice(0, 50), null, 2) +
              (rowCount > 50 ? `\n\n... och ${rowCount - 50} rader till.` : "");
        return { success: true, result: `${rowCount} rader returnerade.\n\n${resultStr}` };
      }
      case "create_artifact":
        return executeCreateArtifact(input);
      case "run_code": {
        const codeResult = await executeRunCode(input, sessionId);
        return {
          success: codeResult.success,
          result: codeResult.result,
          files: codeResult.files,
        };
      }
      case "web_fetch":
        return executeWebFetch(input);
      case "web_search":
        return executeWebSearch(input);
      case "browse_web":
        return executeBrowseWeb(input, sessionId);
      default:
        return { success: false, result: `Okänt verktyg: ${name}` };
    }
  } catch (err) {
    return {
      success: false,
      result: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

// --- Anthropic ---

let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropicClient;
}

export async function* streamAnthropic(
  messages: ChatMessage[],
  model?: string,
  sessionId?: string
): AsyncGenerator<LLMStreamEvent> {
  const client = getAnthropicClient();
  const systemPrompt = getSystemPrompt();

  let anthropicMessages: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: buildAnthropicContent(m.content),
  }));

  yield { type: "thinking" };

  while (true) {
    const stream = client.messages.stream({
      model: model || DEFAULT_ANTHROPIC_MODEL,
      max_tokens: 8192,
      system: systemPrompt,
      tools: ANTHROPIC_TOOLS as Anthropic.Tool[],
      messages: anthropicMessages,
    });

    const contentBlocks: Anthropic.ContentBlock[] = [];

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield { type: "text_delta", content: event.delta.text };
      }
    }

    const finalMessage = await stream.finalMessage();
    for (const block of finalMessage.content) {
      contentBlocks.push(block);
    }

    const toolUseBlocks = contentBlocks.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    if (toolUseBlocks.length === 0) {
      yield {
        type: "done",
        cost: {
          inputTokens: finalMessage.usage.input_tokens,
          outputTokens: finalMessage.usage.output_tokens,
        },
      };
      break;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const toolBlock of toolUseBlocks) {
      yield {
        type: "tool_use",
        toolName: toolBlock.name,
        toolId: toolBlock.id,
        input: toolBlock.input as Record<string, unknown>,
      };

      const toolResult = await executeTool(
        toolBlock.name,
        toolBlock.input as Record<string, unknown>,
        sessionId
      );

      // Emit artifact event if tool created one
      if (toolResult.artifact) {
        yield {
          type: "artifact",
          id: toolResult.artifact.id,
          title: toolResult.artifact.title,
          artifactType: toolResult.artifact.type,
          content: toolResult.artifact.content,
        };
      }

      // Emit file events if tool generated files
      if (toolResult.files && toolResult.files.length > 0) {
        yield { type: "files", files: toolResult.files };
      }

      yield {
        type: "tool_result",
        toolId: toolBlock.id,
        success: toolResult.success,
        summary: toolResult.result.slice(0, 200),
      };

      toolResults.push({
        type: "tool_result",
        tool_use_id: toolBlock.id,
        content: toolResult.result,
      });
    }

    anthropicMessages = [
      ...anthropicMessages,
      { role: "assistant", content: contentBlocks },
      { role: "user", content: toolResults },
    ];
  }
}

// --- Gemini ---

let geminiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return geminiClient;
}

export async function* streamGemini(
  messages: ChatMessage[],
  model?: string,
  sessionId?: string
): AsyncGenerator<LLMStreamEvent> {
  const client = getGeminiClient();
  const systemPrompt = getSystemPrompt();
  const geminiModel = model || DEFAULT_GEMINI_MODEL;

  const contents: Content[] = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: buildGeminiParts(m.content),
  }));

  const tools = [{ functionDeclarations: GEMINI_FUNCTION_DECLARATIONS }];

  while (true) {
    const stream = await client.models.generateContentStream({
      model: geminiModel,
      contents,
      config: {
        systemInstruction: systemPrompt,
        tools,
        thinkingConfig: {
          includeThoughts: true,
        },
      },
    });

    let isThinking = false;
    let hasToolCall = false;
    const functionCallParts: Array<{ name: string; args: Record<string, unknown> }> = [];
    const allParts: Part[] = [];
    let lastUsageMetadata: { promptTokenCount?: number; candidatesTokenCount?: number } = {};

    for await (const chunk of stream) {
      const candidate = chunk.candidates?.[0];
      if (!candidate?.content?.parts) continue;

      if (chunk.usageMetadata) {
        lastUsageMetadata = chunk.usageMetadata;
      }

      for (const part of candidate.content.parts) {
        allParts.push(part);

        if (part.thought) {
          if (!isThinking) {
            isThinking = true;
            yield { type: "thinking" };
          }
          continue;
        }

        if (part.text) {
          isThinking = false;
          yield { type: "text_delta", content: part.text };
        }

        if (part.functionCall) {
          hasToolCall = true;
          functionCallParts.push({
            name: part.functionCall.name!,
            args: (part.functionCall.args as Record<string, unknown>) || {},
          });
        }
      }
    }

    if (!hasToolCall) {
      yield {
        type: "done",
        cost: {
          inputTokens: lastUsageMetadata.promptTokenCount ?? 0,
          outputTokens: lastUsageMetadata.candidatesTokenCount ?? 0,
        },
      };
      break;
    }

    contents.push({ role: "model", parts: allParts });

    const functionResponses: Part[] = [];

    for (const fc of functionCallParts) {
      const toolId = `${fc.name}_${Date.now()}`;
      yield { type: "tool_use", toolName: fc.name, toolId, input: fc.args };

      const toolResult = await executeTool(fc.name, fc.args, sessionId);

      // Emit artifact event if tool created one
      if (toolResult.artifact) {
        yield {
          type: "artifact",
          id: toolResult.artifact.id,
          title: toolResult.artifact.title,
          artifactType: toolResult.artifact.type,
          content: toolResult.artifact.content,
        };
      }

      // Emit file events if tool generated files
      if (toolResult.files && toolResult.files.length > 0) {
        yield { type: "files", files: toolResult.files };
      }

      yield { type: "tool_result", toolId, success: toolResult.success, summary: toolResult.result.slice(0, 200) };

      functionResponses.push({
        functionResponse: {
          name: fc.name,
          response: { result: toolResult.result },
        },
      });
    }

    contents.push({ role: "user", parts: functionResponses });
  }
}

// --- Unified ---

export function streamLLM(
  provider: LLMProvider,
  messages: ChatMessage[],
  model?: string,
  sessionId?: string
): AsyncGenerator<LLMStreamEvent> {
  switch (provider) {
    case "anthropic":
      return streamAnthropic(messages, model, sessionId);
    case "gemini":
      return streamGemini(messages, model, sessionId);
    default:
      throw new Error(`Unknown LLM provider: ${provider}`);
  }
}
