/**
 * Agent Team — Lead agent with delegation to specialists.
 *
 * Architecture:
 *   Lead agent (smart model) ↔ User
 *     - Has all basic tools (query_database, run_code, web_search, etc.)
 *     - Can delegate complex tasks to specialist sub-agents
 *     - Sees all results and synthesizes responses
 *
 * Specialists (invoked via delegate tool):
 *   db_researcher  — focused DB queries with full schema
 *   api_researcher — external API calls (SCB PxWeb etc.)
 *   web_researcher — web search (Google Search grounding on Gemini)
 *   analyst        — data analysis, charts, Python
 *   doc_designer   — .pptx, .xlsx, .docx creation
 *   artifact_designer — interactive HTML dashboards
 */

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI, type Content, type Part, type FunctionDeclaration } from "@google/genai";
import { loadSkills, buildSkillContext, type Skill } from "./skill-loader";
import { buildGeminiParts, buildAnthropicContent } from "./utils/multimodal";
import {
  type LLMProvider,
  type LLMStreamEvent,
  type ChatMessage,
  type ToolResult,
  executeTool,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_GEMINI_MODEL,
} from "./llm-provider";
import {
  queryDatabaseToolDefinition,
  queryDatabaseGeminiTool,
} from "./tools/query-database";
import {
  createArtifactToolDefinition,
  createArtifactGeminiTool,
} from "./tools/create-artifact";
import {
  runCodeToolDefinition,
  runCodeGeminiTool,
} from "./tools/run-code";
import {
  webFetchToolDefinition,
  webFetchGeminiTool,
  webSearchToolDefinition,
  webSearchGeminiTool,
} from "./tools/web-tools";
import {
  browseWebToolDefinition,
  browseWebGeminiTool,
} from "./tools/browse-web";
import { getSchemaContext } from "./db/schema-cache";
import path from "path";

// ---------------------------------------------------------------------------
// Tool registry (shared between lead agent and specialists)
// ---------------------------------------------------------------------------

const TOOL_DEFS: Record<string, { anthropic: object; gemini: object }> = {
  query_database: { anthropic: queryDatabaseToolDefinition, gemini: queryDatabaseGeminiTool },
  create_artifact: { anthropic: createArtifactToolDefinition, gemini: createArtifactGeminiTool },
  run_code: { anthropic: runCodeToolDefinition, gemini: runCodeGeminiTool },
  web_fetch: { anthropic: webFetchToolDefinition, gemini: webFetchGeminiTool },
  web_search: { anthropic: webSearchToolDefinition, gemini: webSearchGeminiTool },
  browse_web: { anthropic: browseWebToolDefinition, gemini: browseWebGeminiTool },
};

// ---------------------------------------------------------------------------
// Delegate tool definition
// ---------------------------------------------------------------------------

const SPECIALIST_NAMES = [
  "db_researcher",
  "api_researcher",
  "web_researcher",
  "analyst",
  "doc_designer",
  "artifact_designer",
] as const;

const delegateToolAnthropic = {
  name: "delegate",
  description: `Delegate a complex task to a specialist sub-agent. Use this when the task needs focused expertise.

Available specialists:
- db_researcher: Query internal databases (company financials, KPIs, planning). Has full DB schema.
- api_researcher: Fetch fresh data from external APIs (SCB PxWeb etc.) via Python code.
- web_researcher: Search the web for news, reports, qualitative info. Do NOT use for data already in a PDF or database.
- analyst: Data analysis, charts, calculations with Python. Can read uploaded PDFs/images directly.
- doc_designer: Create/edit professional files (.pptx, .xlsx, .docx). Uses gemini-pro model. Can read uploaded PDFs.
- artifact_designer: Create interactive HTML dashboards shown in preview panel.

IMPORTANT: Include ALL relevant context in the task description — the specialist only sees what you give it.
If the user uploaded a PDF or image, mention that it's attached — the specialist can see it too.`,
  input_schema: {
    type: "object" as const,
    properties: {
      agent: {
        type: "string" as const,
        enum: SPECIALIST_NAMES as unknown as string[],
        description: "Which specialist to delegate to",
      },
      task: {
        type: "string" as const,
        description: "Detailed task description with all relevant context, data, and requirements",
      },
    },
    required: ["agent", "task"],
  },
};

const delegateToolGemini: FunctionDeclaration = {
  name: "delegate",
  description: delegateToolAnthropic.description,
  parameters: {
    type: "OBJECT" as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    properties: {
      agent: {
        type: "STRING" as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        enum: [...SPECIALIST_NAMES],
        description: "Which specialist to delegate to",
      },
      task: {
        type: "STRING" as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        description: "Detailed task description with all relevant context, data, and requirements",
      },
    },
    required: ["agent", "task"],
  },
};

// ---------------------------------------------------------------------------
// Skill loading
// ---------------------------------------------------------------------------

const SKILL_AGENT_MAP: Record<string, string[]> = {
  "database-query": ["db_researcher"],
  "scb-api": ["api_researcher"],
  "grafisk-profil": ["doc_designer", "artifact_designer"],
  "pptx": ["doc_designer"],
  "docx": ["doc_designer"],
  "xlsx": ["doc_designer"],
  "pdf": ["doc_designer"],
};

let cachedSkills: Skill[] | null = null;

function getSkills(): Skill[] {
  if (!cachedSkills) {
    cachedSkills = loadSkills(path.resolve(process.cwd()));
  }
  return cachedSkills;
}

// ---------------------------------------------------------------------------
// Specialist agent definitions
// ---------------------------------------------------------------------------

interface AgentDef {
  name: string;
  label: string;
  emoji: string;
  promptTemplate: string;
  toolNames: string[];
  modelOverride?: { gemini?: string; anthropic?: string };
  geminiOverrides?: {
    toolNames?: string[];
    googleSearch?: boolean;
  };
}

const SPECIALISTS: Record<string, AgentDef> = {
  db_researcher: {
    name: "db_researcher",
    label: "Databasforskare",
    emoji: "🗄️",
    toolNames: ["query_database"],
    promptTemplate: `Du är en databasspecialist. Hämta exakt den data som efterfrågas.

## Databasschema
{schema}

## Riktlinjer
- Använd EXAKT kolumnnamn från schemat — gissa ALDRIG
- Kör ALLTID först: SELECT MAX(year/bokslutsaar) för att hitta senaste data
- Falkenbergs kommun-id är '1382'
- Leverera STRUKTURERAD data med årtal — analysen görs av den som bad dig

{skills}`,
  },

  api_researcher: {
    name: "api_researcher",
    label: "API-forskare",
    emoji: "📡",
    toolNames: ["run_code"],
    promptTemplate: `Du hämtar data från externa API:er (främst SCB PxWeb) via Python.

## Riktlinjer
- Använd run_code med Python
- SCB: hämta metadata (GET) först, filtrera med "top" för senaste data
- Inkludera Falkenberg (1382) och Riket (00) för jämförelse
- SCB returnerar ANTAL — beräkna andelar själv
- Rate limit: time.sleep(0.5) mellan anrop

{skills}`,
  },

  web_researcher: {
    name: "web_researcher",
    label: "Webbforskare",
    emoji: "🌐",
    toolNames: ["web_search", "web_fetch", "browse_web"],
    geminiOverrides: { toolNames: [], googleSearch: true },
    promptTemplate: `Du söker information på webben.

VIKTIGT: Sök BARA det som uttryckligen efterfrågas. Om informationen redan finns i uppgiftsbeskrivningen — SÖK INTE efter den.

Leverera fakta med URL-källhänvisningar.

{skills}`,
  },

  analyst: {
    name: "analyst",
    label: "Analytiker",
    emoji: "📊",
    toolNames: ["run_code"],
    promptTemplate: `Du analyserar data och skapar diagram med Python.

## VIKTIGT
- Använd run_code för ALLA beräkningar — gissa aldrig
- Om en PDF är bifogad: extrahera ALLA relevanta datapunkter
- Skapa diagram med matplotlib — spara som PNG
- BF-färger: #1B5E7B (primär), #E8A838 (guld), #2E8B57 (grön), #0D3B52 (mörk)
- Leverera en KOMPLETT sammanfattning av alla datapunkter och insikter

{skills}`,
  },

  doc_designer: {
    name: "doc_designer",
    label: "Dokumentdesigner",
    emoji: "📑",
    toolNames: ["run_code"],
    modelOverride: { gemini: "gemini-3.1-pro-preview" },
    promptTemplate: `Du skapar professionella nedladdningsbara filer med Python.

## Bibliotek: python-pptx, openpyxl, python-docx, Pillow, matplotlib

## VIKTIGT
- Anropa ALLTID run_code — skriv aldrig bara kod som text
- Om en PDF är bifogad: basera dokumentet på DESS innehåll
- Basera på ALL data du fått i uppgiftsbeskrivningen
- Diagrambilder finns i arbetskatalogen — använd dem!
- Följ Business Falkenbergs grafiska profil
- Vid redigering: öppna befintlig fil, ändra, spara med samma namn

{skills}`,
  },

  artifact_designer: {
    name: "artifact_designer",
    label: "Artifaktdesigner",
    emoji: "✨",
    toolNames: ["create_artifact"],
    promptTemplate: `Du skapar interaktiva HTML-dashboards som visas i en preview-panel.

Använd ALLTID create_artifact med type "html" och en komplett HTML-sida.
CDN: Tailwind CSS, Chart.js, D3.js, Three.js, Mermaid, Recharts
BF-färger: #1f4e99, #009fe3, #52ae32, #f39200, #13153b

Om <existing-artifact>-taggar finns: gör BARA de ändringar som efterfrågas.

{skills}`,
  },
};

// ---------------------------------------------------------------------------
// Lead agent system prompt
// ---------------------------------------------------------------------------

function buildLeadAgentPrompt(): string {
  const skills = getSkills();
  const skillContext = buildSkillContext(skills);
  const schemaContext = getSchemaContext();

  return `Du är en AI-assistent för Business Falkenberg. Du hjälper medarbetare med research, data, dokument och analys.

## Hur du arbetar

Du har verktyg du kan använda direkt:
- query_database — fråga våra interna databaser
- run_code — kör Python/JavaScript-kod
- web_search + web_fetch — sök och hämta info från webben
- create_artifact — skapa interaktiva HTML-dashboards
- browse_web — besök webbsidor med headless browser

Du kan också DELEGERA komplexa uppgifter till specialister med delegate-verktyget:
- db_researcher — fokuserade databas-queries (har komplett schema)
- api_researcher — hämtar data från externa API:er (SCB etc.)
- web_researcher — djup webbsökning (Gemini: Google Search grounding)
- analyst — dataanalys, diagram, beräkningar med Python
- doc_designer — skapar .pptx, .xlsx, .docx (använder gemini-pro)
- artifact_designer — interaktiva HTML-dashboards

## När du gör det själv vs delegerar

GÖR SJÄLV:
- Enkel chatt, frågor, förklaringar
- Enkla databas-queries (du har query_database)
- Snabb kodkörning
- Kort sammanfattning av en bifogad PDF

DELEGERA:
- Komplexa flerstegsprojekt (t.ex. "analysera data och gör en presentation")
- Dokumentskapande (.pptx, .xlsx, .docx) — delegera till doc_designer
- Djup dataanalys med diagram — delegera till analyst
- Stora databas-undersökningar — delegera till db_researcher (har komplett schema)

Du kan delegera FLERA gånger i rad, t.ex.:
1. delegate till analyst ("analysera denna PDF och skapa diagram")
2. Se resultatet
3. delegate till doc_designer ("skapa en pptx baserad på analysen ovan")

## Bifogade filer (PDF, bilder)

Om användaren laddar upp en fil syns den som <attachment type="pdf" .../> i meddelandet.
- Du KAN läsa den direkt (multimodal)
- Specialister du delegerar till KAN OCKSÅ läsa den
- SÖK INTE på webben efter innehåll som redan finns i en bifogad fil!

## Våra databaser

${schemaContext}

Falkenbergs kommun-id: '1382'
naringslivsklimat har 14 kustkommuner: Falkenberg, Göteborg, Kungsbacka, Varberg, Halmstad, Laholm, Båstad, Ängelholm, Höganäs, Helsingborg, Landskrona, Kävlinge, Lomma, Malmö

## Riktlinjer
- Svara alltid på svenska om inte användaren skriver på annat språk
- Var professionell, koncis och hjälpsam
- När du delegerar: inkludera ALL relevant kontext i task-beskrivningen
- Om du delegerat och fått tillbaka resultat: syntetisera och presentera snyggt för användaren

${skillContext}`;
}

// ---------------------------------------------------------------------------
// Build specialist prompt
// ---------------------------------------------------------------------------

function buildSpecialistPrompt(agentDef: AgentDef): string {
  const skills = getSkills();
  const agentSkills = skills.filter((s) => {
    const targets = SKILL_AGENT_MAP[s.name];
    if (!targets) return false; // specialists only get their own skills
    return targets.includes(agentDef.name);
  });

  const skillContext = agentSkills.length > 0 ? buildSkillContext(agentSkills) : "";

  return agentDef.promptTemplate
    .replace("{skills}", skillContext)
    .replace("{schema}", agentDef.name === "db_researcher" ? getSchemaContext() : "")
    + "\n\nSvara alltid på svenska om inte annat anges.";
}

// ---------------------------------------------------------------------------
// Cost tracking
// ---------------------------------------------------------------------------

interface CostAccumulator {
  inputTokens: number;
  outputTokens: number;
}

// ---------------------------------------------------------------------------
// Execute delegate — runs a specialist sub-agent and collects results
// ---------------------------------------------------------------------------

async function executeDelegate(
  agentName: string,
  task: string,
  userMessage: string,
  provider: LLMProvider,
  model: string,
  sessionId: string | undefined,
  costs: CostAccumulator,
  onEvent: (event: LLMStreamEvent) => void
): Promise<ToolResult> {
  const agentDef = SPECIALISTS[agentName];
  if (!agentDef) {
    return { success: false, result: `Unknown specialist: ${agentName}` };
  }

  onEvent({
    type: "agent_status" as LLMStreamEvent["type"],
    agent: agentDef.name,
    content: `${agentDef.emoji} ${agentDef.label}: ${task.slice(0, 100)}...`,
  });

  const systemPrompt = buildSpecialistPrompt(agentDef);

  // Specialist gets: the delegate task + the original user message (for attachments)
  const fullTask = `## Uppgift\n${task}\n\n## Ursprungligt meddelande från användaren\n${userMessage}`;

  // Get tools for specialist
  const toolNames =
    provider === "gemini" && agentDef.geminiOverrides?.toolNames
      ? agentDef.geminiOverrides.toolNames
      : agentDef.toolNames;
  const tools = toolNames
    .filter((name) => name in TOOL_DEFS)
    .map((name) => TOOL_DEFS[name][provider]);

  const agentModel =
    (provider === "gemini" ? agentDef.modelOverride?.gemini : agentDef.modelOverride?.anthropic)
    || model;

  const useGoogleSearch = provider === "gemini" && agentDef.geminiOverrides?.googleSearch;

  // Run the specialist sub-agent
  let agentOutput = "";
  const collectedFiles: Array<{ id: string; filename: string; mimeType: string; sizeBytes: number }> = [];
  let collectedArtifact: ToolResult["artifact"] = undefined;

  const runner =
    provider === "anthropic"
      ? runSubAgentAnthropic(systemPrompt, fullTask, tools as Anthropic.Tool[], agentModel, sessionId, costs)
      : runSubAgentGemini(systemPrompt, fullTask, tools, agentModel, sessionId, costs, {
          googleSearch: useGoogleSearch,
        });

  for await (const event of runner) {
    // Forward events with agent tag
    onEvent({ ...event, agent: agentDef.name } as LLMStreamEvent);

    if (event.type === "text_delta" && event.content) {
      agentOutput += event.content;
    }
    if (event.type === "files" && event.files) {
      collectedFiles.push(...event.files);
    }
    if (event.type === "artifact") {
      collectedArtifact = {
        id: event.id!,
        title: event.title!,
        type: event.artifactType!,
        content: event.content!,
      };
    }
  }

  onEvent({
    type: "agent_status" as LLMStreamEvent["type"],
    agent: agentDef.name,
    content: `${agentDef.emoji} ${agentDef.label} klar`,
  });

  return {
    success: true,
    result: agentOutput || "(Specialisten returnerade inget textresultat)",
    files: collectedFiles.length > 0 ? collectedFiles : undefined,
    artifact: collectedArtifact,
  };
}

// ---------------------------------------------------------------------------
// Sub-agent runners (same as before, just renamed for clarity)
// ---------------------------------------------------------------------------

async function* runSubAgentAnthropic(
  systemPrompt: string,
  task: string,
  tools: Anthropic.Tool[],
  model: string,
  sessionId: string | undefined,
  costs: CostAccumulator
): AsyncGenerator<LLMStreamEvent> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let messages: Anthropic.MessageParam[] = [{ role: "user", content: buildAnthropicContent(task) }];
  const toolsParam = tools.length > 0 ? tools : undefined;

  while (true) {
    const stream = client.messages.stream({
      model,
      max_tokens: 16384,
      system: systemPrompt,
      ...(toolsParam ? { tools: toolsParam } : {}),
      messages,
    });

    const contentBlocks: Anthropic.ContentBlock[] = [];

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield { type: "text_delta", content: event.delta.text };
      }
    }

    const finalMessage = await stream.finalMessage();
    costs.inputTokens += finalMessage.usage.input_tokens;
    costs.outputTokens += finalMessage.usage.output_tokens;

    for (const block of finalMessage.content) {
      contentBlocks.push(block);
    }

    const toolUseBlocks = contentBlocks.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    if (toolUseBlocks.length === 0) break;

    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const toolBlock of toolUseBlocks) {
      yield { type: "tool_use", toolName: toolBlock.name, toolId: toolBlock.id, input: toolBlock.input as Record<string, unknown> };

      const result = await executeTool(toolBlock.name, toolBlock.input as Record<string, unknown>, sessionId);

      if (result.artifact) {
        yield { type: "artifact", id: result.artifact.id, title: result.artifact.title, artifactType: result.artifact.type, content: result.artifact.content };
      }
      if (result.files && result.files.length > 0) {
        yield { type: "files", files: result.files };
      }

      yield { type: "tool_result", toolId: toolBlock.id, success: result.success, summary: result.result.slice(0, 200) };

      toolResults.push({ type: "tool_result", tool_use_id: toolBlock.id, content: result.result });
    }

    messages = [...messages, { role: "assistant", content: contentBlocks }, { role: "user", content: toolResults }];
  }
}

async function* runSubAgentGemini(
  systemPrompt: string,
  task: string,
  tools: unknown[],
  model: string,
  sessionId: string | undefined,
  costs: CostAccumulator,
  options?: { googleSearch?: boolean }
): AsyncGenerator<LLMStreamEvent> {
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const contents: Content[] = [{ role: "user", parts: buildGeminiParts(task) }];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toolConfig: any[] = [];
  if (tools.length > 0) {
    toolConfig.push({ functionDeclarations: tools as FunctionDeclaration[] });
  }
  if (options?.googleSearch) {
    toolConfig.push({ googleSearch: {} });
  }

  while (true) {
    const stream = await client.models.generateContentStream({
      model,
      contents,
      config: {
        systemInstruction: systemPrompt,
        tools: toolConfig.length > 0 ? toolConfig : undefined,
        thinkingConfig: { includeThoughts: true },
      },
    });

    let hasToolCall = false;
    const functionCallParts: Array<{ name: string; args: Record<string, unknown> }> = [];
    const allParts: Part[] = [];
    let lastUsage: { promptTokenCount?: number; candidatesTokenCount?: number } = {};

    for await (const chunk of stream) {
      const candidate = chunk.candidates?.[0];
      if (!candidate?.content?.parts) continue;
      if (chunk.usageMetadata) lastUsage = chunk.usageMetadata;

      for (const part of candidate.content.parts) {
        allParts.push(part);
        if (part.thought) continue;
        if (part.text) yield { type: "text_delta", content: part.text };
        if (part.functionCall) {
          hasToolCall = true;
          functionCallParts.push({ name: part.functionCall.name!, args: (part.functionCall.args as Record<string, unknown>) || {} });
        }
      }
    }

    costs.inputTokens += lastUsage.promptTokenCount ?? 0;
    costs.outputTokens += lastUsage.candidatesTokenCount ?? 0;

    if (!hasToolCall) break;

    contents.push({ role: "model", parts: allParts });

    const functionResponses: Part[] = [];

    for (const fc of functionCallParts) {
      const toolId = `${fc.name}_${Date.now()}`;
      yield { type: "tool_use", toolName: fc.name, toolId, input: fc.args };

      const result = await executeTool(fc.name, fc.args, sessionId);

      if (result.artifact) {
        yield { type: "artifact", id: result.artifact.id, title: result.artifact.title, artifactType: result.artifact.type, content: result.artifact.content };
      }
      if (result.files && result.files.length > 0) {
        yield { type: "files", files: result.files };
      }

      yield { type: "tool_result", toolId, success: result.success, summary: result.result.slice(0, 200) };

      functionResponses.push({ functionResponse: { name: fc.name, response: { result: result.result } } });
    }

    contents.push({ role: "user", parts: functionResponses });
  }
}

// ---------------------------------------------------------------------------
// Lead agent runner — Gemini
// ---------------------------------------------------------------------------

async function* runLeadAgentGemini(
  messages: ChatMessage[],
  model: string,
  sessionId: string | undefined,
  costs: CostAccumulator,
  eventBuffer: LLMStreamEvent[]
): AsyncGenerator<LLMStreamEvent> {
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const systemPrompt = buildLeadAgentPrompt();

  // Build contents from conversation history
  const contents: Content[] = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: buildGeminiParts(m.content),
  }));

  // All tools: regular + delegate
  const allGeminiTools = [
    ...Object.values(TOOL_DEFS).map((t) => t.gemini),
    delegateToolGemini,
  ];
  const toolConfig = [{ functionDeclarations: allGeminiTools as FunctionDeclaration[] }];

  // Keep track of user message for passing to delegates
  const userMessage = messages[messages.length - 1]?.content || "";

  while (true) {
    const stream = await client.models.generateContentStream({
      model,
      contents,
      config: {
        systemInstruction: systemPrompt,
        tools: toolConfig,
        thinkingConfig: { includeThoughts: true },
      },
    });

    let hasToolCall = false;
    const functionCallParts: Array<{ name: string; args: Record<string, unknown> }> = [];
    const allParts: Part[] = [];
    let lastUsage: { promptTokenCount?: number; candidatesTokenCount?: number } = {};

    for await (const chunk of stream) {
      const candidate = chunk.candidates?.[0];
      if (!candidate?.content?.parts) continue;
      if (chunk.usageMetadata) lastUsage = chunk.usageMetadata;

      for (const part of candidate.content.parts) {
        allParts.push(part);
        if (part.thought) continue;
        if (part.text) yield { type: "text_delta", content: part.text };
        if (part.functionCall) {
          hasToolCall = true;
          functionCallParts.push({ name: part.functionCall.name!, args: (part.functionCall.args as Record<string, unknown>) || {} });
        }
      }
    }

    costs.inputTokens += lastUsage.promptTokenCount ?? 0;
    costs.outputTokens += lastUsage.candidatesTokenCount ?? 0;

    if (!hasToolCall) break;

    contents.push({ role: "model", parts: allParts });

    const functionResponses: Part[] = [];

    for (const fc of functionCallParts) {
      const toolId = `${fc.name}_${Date.now()}`;
      yield { type: "tool_use", toolName: fc.name, toolId, input: fc.args };

      let result: ToolResult;

      if (fc.name === "delegate") {
        // --- DELEGATION: Run specialist sub-agent ---
        result = await executeDelegate(
          fc.args.agent as string,
          fc.args.task as string,
          userMessage,
          "gemini",
          model,
          sessionId,
          costs,
          (event) => eventBuffer.push(event)
        );
      } else {
        // --- Regular tool execution ---
        result = await executeTool(fc.name, fc.args, sessionId);
      }

      if (result.artifact) {
        yield { type: "artifact", id: result.artifact.id, title: result.artifact.title, artifactType: result.artifact.type, content: result.artifact.content };
      }
      if (result.files && result.files.length > 0) {
        yield { type: "files", files: result.files };
      }

      yield { type: "tool_result", toolId, success: result.success, summary: result.result.slice(0, 200) };

      functionResponses.push({ functionResponse: { name: fc.name, response: { result: result.result } } });
    }

    contents.push({ role: "user", parts: functionResponses });
  }
}

// ---------------------------------------------------------------------------
// Lead agent runner — Anthropic
// ---------------------------------------------------------------------------

async function* runLeadAgentAnthropic(
  messages: ChatMessage[],
  model: string,
  sessionId: string | undefined,
  costs: CostAccumulator,
  eventBuffer: LLMStreamEvent[]
): AsyncGenerator<LLMStreamEvent> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const systemPrompt = buildLeadAgentPrompt();

  let anthropicMessages: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: buildAnthropicContent(m.content),
  }));

  const allTools = [
    ...Object.values(TOOL_DEFS).map((t) => t.anthropic),
    delegateToolAnthropic,
  ] as Anthropic.Tool[];

  const userMessage = messages[messages.length - 1]?.content || "";

  while (true) {
    const stream = client.messages.stream({
      model,
      max_tokens: 16384,
      system: systemPrompt,
      tools: allTools,
      messages: anthropicMessages,
    });

    const contentBlocks: Anthropic.ContentBlock[] = [];

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield { type: "text_delta", content: event.delta.text };
      }
    }

    const finalMessage = await stream.finalMessage();
    costs.inputTokens += finalMessage.usage.input_tokens;
    costs.outputTokens += finalMessage.usage.output_tokens;

    for (const block of finalMessage.content) {
      contentBlocks.push(block);
    }

    const toolUseBlocks = contentBlocks.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    if (toolUseBlocks.length === 0) break;

    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const toolBlock of toolUseBlocks) {
      yield { type: "tool_use", toolName: toolBlock.name, toolId: toolBlock.id, input: toolBlock.input as Record<string, unknown> };

      let result: ToolResult;

      if (toolBlock.name === "delegate") {
        const input = toolBlock.input as { agent: string; task: string };
        result = await executeDelegate(
          input.agent,
          input.task,
          userMessage,
          "anthropic",
          model,
          sessionId,
          costs,
          (event) => eventBuffer.push(event)
        );
      } else {
        result = await executeTool(toolBlock.name, toolBlock.input as Record<string, unknown>, sessionId);
      }

      if (result.artifact) {
        yield { type: "artifact", id: result.artifact.id, title: result.artifact.title, artifactType: result.artifact.type, content: result.artifact.content };
      }
      if (result.files && result.files.length > 0) {
        yield { type: "files", files: result.files };
      }

      yield { type: "tool_result", toolId: toolBlock.id, success: result.success, summary: result.result.slice(0, 200) };

      toolResults.push({ type: "tool_result", tool_use_id: toolBlock.id, content: result.result });
    }

    anthropicMessages = [
      ...anthropicMessages,
      { role: "assistant", content: contentBlocks },
      { role: "user", content: toolResults },
    ];
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export type AgentTeamMode = "auto" | "team" | "simple";

export async function* streamAgentTeam(
  messages: ChatMessage[],
  provider: LLMProvider,
  model?: string,
  sessionId?: string,
  mode: AgentTeamMode = "auto"
): AsyncGenerator<LLMStreamEvent> {
  const resolvedModel =
    model || (provider === "anthropic" ? DEFAULT_ANTHROPIC_MODEL : DEFAULT_GEMINI_MODEL);

  // --- Simple mode: flat tool loop, no delegation ---
  if (mode === "simple") {
    const { streamLLM } = await import("./llm-provider");
    yield* streamLLM(provider, messages, model, sessionId);
    return;
  }

  // --- Auto/Team mode: lead agent with delegation ---
  const costs: CostAccumulator = { inputTokens: 0, outputTokens: 0 };

  // eventBuffer collects events from sub-agents during delegation
  // (since we can't yield from inside executeDelegate's callback)
  const eventBuffer: LLMStreamEvent[] = [];

  const runner =
    provider === "anthropic"
      ? runLeadAgentAnthropic(messages, resolvedModel, sessionId, costs, eventBuffer)
      : runLeadAgentGemini(messages, resolvedModel, sessionId, costs, eventBuffer);

  for await (const event of runner) {
    // First, flush any buffered events from sub-agents
    while (eventBuffer.length > 0) {
      yield eventBuffer.shift()!;
    }
    yield event;
  }

  // Flush remaining buffered events
  while (eventBuffer.length > 0) {
    yield eventBuffer.shift()!;
  }

  yield { type: "done", cost: costs };
}
