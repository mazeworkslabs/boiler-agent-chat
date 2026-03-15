/**
 * Agent Team — Multi-agent orchestration for complex tasks.
 *
 * 6 specialized agents:
 *   db_researcher  — database queries (has full schema injected)
 *   web_researcher  — web search + crawling (Gemini Google Search grounding)
 *   analyst         — data analysis + code execution + charts
 *   doc_designer    — file generation (.pptx, .docx, .xlsx, .pdf)
 *   artifact_designer — interactive HTML dashboards + visualizations
 *   writer          — text output (reports, summaries, emails) — no tools
 *
 * The orchestrator classifies incoming requests and routes to the right agents.
 * Agents run sequentially, sharing context via accumulated output.
 */

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI, type Content, type Part, type FunctionDeclaration } from "@google/genai";
import { loadSkills, buildSkillContext, type Skill } from "./skill-loader";
import {
  type LLMProvider,
  type LLMStreamEvent,
  type ChatMessage,
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
// Tool registry
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
// Skill → Agent routing
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

// ---------------------------------------------------------------------------
// Agent definitions
// ---------------------------------------------------------------------------

interface AgentDef {
  name: string;
  label: string;
  emoji: string;
  promptTemplate: string;
  toolNames: string[];
  /** Override model per provider for this agent */
  modelOverride?: { gemini?: string; anthropic?: string };
  geminiOverrides?: {
    toolNames?: string[];      // override tools for Gemini
    googleSearch?: boolean;    // enable Google Search grounding
  };
}

const AGENTS: Record<string, AgentDef> = {
  db_researcher: {
    name: "db_researcher",
    label: "Databasforskare",
    emoji: "🗄️",
    toolNames: ["query_database"],
    promptTemplate: `Du är en databasspecialist för Business Falkenberg.

Du har KOMPLETT kunskap om alla databaser. Använd schemat nedan — gissa ALDRIG kolumnnamn.

## Databasschema

{schema}

## STEG 1 — Hitta senaste data FÖRST (OBLIGATORISKT)

Innan du hämtar data, kör ALLTID en query per relevant tabell för att hitta senaste tillgängliga år:

\`\`\`sql
-- Exempel för company_financials:
SELECT MAX(bokslutsaar) FROM company_financials;
-- Exempel för indicator_values:
SELECT indicator_id, MAX(year) FROM indicator_values GROUP BY indicator_id;
-- Exempel för scb_income_distribution:
SELECT MAX(year) FROM scb_income_distribution;
\`\`\`

Använd sedan det senaste året i dina dataqueries. Anta ALDRIG att senaste år är 2023 — det kan vara 2024 eller 2025.

## Riktlinjer
- Använd EXAKT de kolumnnamn som finns i schemat ovan
- Kör FLERA queries om det behövs — grunddata + kontext + jämförelser
- Kombinera data från FLERA databaser om det ger rikare kontext
- Falkenbergs kommun-id är '1382'
- Använd LIMIT om du inte vet hur stor resultatet blir
- Leverera STRUKTURERAD data — analysen gör en annan specialist
- Om data saknas, notera det tydligt
- Inkludera ALLTID vilket år datan gäller

Svara med:
1. Senaste tillgängliga år per datakälla
2. Vilka queries du körde (med databas)
3. Eventuella begränsningar i datan

{skills}`,
  },

  web_researcher: {
    name: "web_researcher",
    label: "Webbforskare",
    emoji: "🌐",
    // Anthropic: uses web_search + web_fetch + browse_web
    toolNames: ["web_search", "web_fetch", "browse_web"],
    // Gemini: Google Search grounding ONLY (can't mix with function declarations)
    geminiOverrides: {
      toolNames: [],
      googleSearch: true,
    },
    promptTemplate: `Du är en omvärldsresearcher för Business Falkenberg.

Din uppgift är att hitta extern information från webben — nyheter, rapporter, benchmarks, statistik.

## Riktlinjer
- Sök brett och djupt — använd flera söktermer
- Hämta och läs relevanta sidor för att få detaljerad information
- Använd browse_web för JavaScript-tunga sidor (SPAs, dynamiska dashboards)
- Använd web_fetch för enkla text/HTML-sidor och API:er
- Sammanfatta fynd med källhänvisningar (URL:er)
- Fokusera på FAKTA, inte åsikter
- Om du hittar data som kan jämföras med intern data, notera det

Svara med:
1. Sammanfattning av fynd
2. Detaljerade data/citat med källhänvisning
3. Relevanta URL:er

{skills}`,
  },

  api_researcher: {
    name: "api_researcher",
    label: "API-forskare",
    emoji: "📡",
    toolNames: ["run_code"],
    promptTemplate: `Du är en expert på att hämta data från externa API:er för Business Falkenberg.

Din huvudsakliga datakälla är SCB:s PxWeb API, men du kan även hämta data från andra öppna API:er.

## VIKTIGT
- Använd ALLTID run_code med Python för att göra API-anrop
- Hämta ALLTID metadata (GET) först för att se variabelkoder och tillgängliga år
- Inkludera alltid Falkenberg (1382) och gärna Riket (00) för jämförelse
- SCB returnerar ANTAL, inte procent — beräkna andelar själv
- Använd filter "top" för senaste data, inte hårdkodade år
- Rate limit: 30 req / 10 sek — lägg in time.sleep(0.5) mellan anrop
- Presentera resultaten som strukturerad data — analysen gör en annan specialist

{skills}`,
  },

  analyst: {
    name: "analyst",
    label: "Analytiker",
    emoji: "📊",
    toolNames: ["run_code"],
    promptTemplate: `Du är en analytiker för Business Falkenberg.

Din uppgift är att analysera data och producera insikter med Python-kod.

## VIKTIGT — Kör alltid kod
Du MÅSTE använda run_code för ALLA beräkningar. Gissa aldrig siffror.

## Riktlinjer
- Använd pandas för datamanipulation
- Skapa diagram med matplotlib/seaborn — spara som PNG med beskrivande namn
- Beräkna: trender, procentuella förändringar, jämförelser, rankningar
- Identifiera mönster, avvikelser och nyckelfynd
- Formulera 3–5 konkreta insikter
- BF-färger: #1B5E7B (primär), #E8A838 (guld), #2E8B57 (grön), #0D3B52 (mörk)
- Avsluta med tydlig sammanfattning — nästa agent bygger vidare

Diagramfiler du sparar blir automatiskt tillgängliga för designer-agenten.

{skills}`,
  },

  doc_designer: {
    name: "doc_designer",
    label: "Dokumentdesigner",
    emoji: "📑",
    toolNames: ["run_code"],
    modelOverride: { gemini: "gemini-3.1-pro-preview" },
    promptTemplate: `Du är en dokumentdesigner för Business Falkenberg.

Din uppgift är att skapa professionella nedladdningsbara filer.

## Verktyg
Du har run_code som kör Python i en sandbox med dessa bibliotek:
- python-pptx (presentationer .pptx)
- openpyxl (Excel .xlsx)
- python-docx (Word .docx — om tillgängligt)
- Pillow, matplotlib (bilder och diagram)

## VIKTIGT
- Anropa ALLTID run_code — skriv aldrig bara kodsnuttar som text
- Filer som sparas i arbetskatalogen blir automatiskt nedladdningsbara
- Diagrambilder från analytikern finns i arbetskatalogen — använd dem!
- Följ ALLTID Business Falkenbergs grafiska profil

## Redigera befintliga filer

Tidigare genererade filer i sessionen finns redan i arbetskatalogen. Om användaren ber dig redigera/uppdatera ett dokument:

1. Lista filer först: \`import os; print(os.listdir('.'))\`
2. Öppna befintlig fil: \`prs = Presentation("filnamn.pptx")\` eller \`wb = load_workbook("filnamn.xlsx")\`
3. Gör ändringarna
4. Spara med SAMMA filnamn för att ersätta, eller nytt namn för en ny version

Skapa ALDRIG en ny fil från scratch om användaren ber dig ändra en befintlig.

## Riktlinjer
- Variera layouter — inte bara text och bullet points
- Inkludera visuella element på varje sida/sektion
- Ge en kort sammanfattning EFTER att filen skapats

{skills}`,
  },

  artifact_designer: {
    name: "artifact_designer",
    label: "Artifaktdesigner",
    emoji: "✨",
    toolNames: ["create_artifact"],
    promptTemplate: `Du är en UI-designer för Business Falkenberg.

Din uppgift är att skapa interaktiva HTML-dashboards och visualiseringar som visas i en preview-panel.

## VIKTIGT — Använd ALLTID create_artifact
Anropa create_artifact med:
- title: Beskrivande titel
- type: "html"
- content: En KOMPLETT HTML-sida (<html>, <head>, <body>)

Skriv ALDRIG HTML-kod som text. Använd ALLTID create_artifact-verktyget.

## REDIGERING AV BEFINTLIG ARTIFACT
Om meddelandet innehåller <existing-artifact>-taggar har användaren tryckt "Redigera" på en befintlig artifact.
- Gör BARA de ändringar användaren ber om — ändra INTE resten av HTML:en
- Behåll all befintlig struktur, data och styling
- Anropa create_artifact med den uppdaterade HTML:en (samma title om inte annat anges)

## Tillgängliga CDN-bibliotek (injiceras automatiskt)
Tailwind CSS, Chart.js, D3.js, Three.js, Mermaid, Recharts

## BILDER I ARTIFACTS
Artifacts körs i en sandboxad iframe. Du kan INTE referera bilder från sessionen (screenshots, diagram-PNG:er).
Istället:
- Skapa diagram DIREKT i HTML med Chart.js eller D3.js — bädda in datan i koden
- Använd SVG-grafik istället för bilder
- Om du har sifferdata från analytikern, bygg diagrammet i JavaScript i artifakten

## Riktlinjer
- Skapa responsiva, interaktiva dashboards
- Använd BF-färger: #1f4e99, #009fe3, #52ae32, #f39200, #13153b
- Inkludera diagram (Chart.js/D3), nyckeltal (KPIs), tabeller
- Gör det visuellt tilltalande och professionellt
- Ge en kort sammanfattning EFTER att artifakten skapats

{skills}`,
  },

  writer: {
    name: "writer",
    label: "Skribent",
    emoji: "✍️",
    toolNames: [],
    promptTemplate: `Du är en professionell skribent för Business Falkenberg.

Din uppgift är att skriva text direkt i chatten — rapporter, sammanfattningar, e-post, texter, analyser.

## Riktlinjer
- Skriv professionellt och koncist
- Strukturera med rubriker, punktlistor och styckeindelning
- Anpassa ton efter mottagare (intern rapport vs externt nyhetsbrev)
- Basera ALLT på data och insikter från kontexten nedan
- Inkludera konkreta siffror och exempel
- Om det är ett mejl, inkludera ämnesrad

{skills}`,
  },
};

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

const CLASSIFY_PROMPT = `Analysera användarens meddelande och bestäm om det kräver ett specialistteam eller kan besvaras direkt.

Svara med JSON:

Enkla uppgifter (hälsningar, korta frågor, förklaringar, enkel datauppslag):
{"mode":"simple"}

Komplexa uppgifter:
{"mode":"team","tasks":[
  {"agent":"<agent_name>","task":"Specifik instruktion..."},
  ...
]}

## Vad finns i våra databaser (db_researcher)

Vi har MYCKET data internt — använd ALLTID db_researcher FÖRST. Använd web_researcher bara för saker som verkligen inte finns i våra databaser.

### fbg_analytics — Företagsdata
- company_financials: bokslut per företag/år (omsättning, anställda, bransch, soliditet, rörelsemarginal) för alla företag i Falkenberg
- job_postings: platsannonser
- scb_employment_stats: sysselsättningsstatistik

### naringslivsklimat — Benchmarking 14 kustkommuner (Göteborg→Malmö längs E6/Kattegatt)
Kommuner: Falkenberg, Göteborg, Kungsbacka, Varberg, Halmstad, Laholm, Båstad, Ängelholm, Höganäs, Helsingborg, Landskrona, Kävlinge, Lomma, Malmö
- indicator_values: 24+ KPIs per kommun/år (2010-nutid): nya företag, konkurser, sysselsättning, branschbredd, omsättning, pendling, utbildning, befolkning, medianinkomst, skattekraft
- scb_housing_detail: bostadspriser per kommun (permanent/fritid)
- scb_income_distribution: inkomstfördelning P1-P100, D1-D10 per kommun
- scb_leading_indicators: bygglov, bilregistreringar, befolkningsförändringar (månad/kvartal)

### fbg_planning — Århjulet
- activities, focus_areas, strategic_concepts

## Tillgängliga agenter

- db_researcher — hämtar data från ALLA databaser ovan (komplett schema injicerat)
- api_researcher — hämtar FÄRSK data direkt från externa API:er (SCB PxWeb, m.fl.) via Python-kod. Använd när data saknas i våra databaser eller behöver vara mer aktuell.
- web_researcher — söker på webben — BARA för nyheter, rapporter, kvalitativ info (INTE statistik — använd api_researcher istället)
- analyst — analyserar data, kör Python-kod, skapar diagram
- doc_designer — skapar OCH REDIGERAR nedladdningsbara filer (.pptx, .xlsx, .docx). Kan öppna och ändra befintliga filer från sessionen!
- artifact_designer — skapar interaktiva HTML-dashboards i preview-panelen
- writer — skriver text direkt i chatten (rapporter, mejl, sammanfattningar)

## VIKTIGT: Redigering av befintliga filer

doc_designer kan REDIGERA filer som redan skapats i sessionen. Om användaren ber om ändringar i en befintlig fil (t.ex. "lägg till slides", "ändra data till 2024", "uppdatera diagrammet"):
- Skapa INTE allt från scratch — be doc_designer redigera den befintliga filen
- Om ny data behövs (t.ex. "ändra till 2024") → kör db_researcher FÖRST för att hämta uppdaterad data, SEN doc_designer för att redigera filen
- Ange filnamnet som ska redigeras i doc_designers task-beskrivning

## Exempel

- "Vilka är de 10 största företagen?" → {"mode":"simple"}
- "Jämför Falkenberg med Varberg" → db_researcher → analyst (data FINNS i naringslivsklimat!)
- "Analysera befolkningsutvecklingen med diagram" → db_researcher → analyst
- "Skriv ett mejl om senaste kvartalet" → db_researcher → writer
- "Gör en presentation om näringslivsklimatet" → db_researcher → analyst → doc_designer
- "Skapa en dashboard över företagsdata" → db_researcher → analyst → artifact_designer
- "Vad skriver media om Falkenbergs näringsliv?" → web_researcher (detta finns INTE i db)
- "Jämför vår data med rikssnitt och nyheter" → db_researcher → web_researcher → analyst
- "Hur ser befolkningsutvecklingen ut per åldersgrupp?" → api_researcher (detaljerad SCB-data) → analyst
- "Hämta utbildningsnivå från SCB" → api_researcher → analyst
- "Lägg till 2 slides om inkomst i presentationen" → doc_designer (redigera befintlig fil)
- "Datan var för 2023, uppdatera till 2024" → db_researcher → doc_designer (hämta ny data, sen redigera filen)
- "Ändra titeln på slide 3" → doc_designer (redigera befintlig fil, ingen ny data behövs)

## Regler

- Använd ALLTID db_researcher för data som finns i våra databaser (fbg_analytics, naringslivsklimat, fbg_planning).
- Använd api_researcher för FÄRSK statistik från SCB eller andra API:er — speciellt data vi inte har i egna databaser.
- Använd web_researcher BARA för nyheter, rapporter, kvalitativ info — INTE för statistik (api_researcher är bättre).
- Jämförelser mellan kommuner → db_researcher (vi har 14 kommuner i naringslivsklimat!).
- analyst behöver data — kör alltid researcher FÖRE analyst.
- doc_designer och artifact_designer är ALDRIG i samma plan.
- doc_designer → nedladdningsbar fil (.pptx, .xlsx, .docx) — kan REDIGERA befintliga filer
- artifact_designer → interaktiv HTML i preview-panelen
- writer → text direkt i chatten
- Vid redigeringsförfrågningar för dokument: använd doc_designer DIREKT. Skapa INTE om hela filen.
- Vid redigeringsförfrågningar för artifacts (HTML): använd artifact_designer DIREKT. Meddelandet innehåller befintlig HTML i <existing-artifact>-taggar.
- Om meddelandet börjar med [REDIGERA ARTIFACT] → kör ALLTID artifact_designer direkt, inga andra agenter behövs.
- Varje task-beskrivning ska vara SPECIFIK. Vid redigering: ange exakt vad som ska ändras.

Svara BARA med JSON.`;

interface AgentTask {
  agent: string;
  task: string;
}

interface Plan {
  mode: "simple" | "team";
  tasks?: AgentTask[];
}

async function classifyTask(userMessage: string, provider: LLMProvider): Promise<Plan> {
  try {
    let text: string;

    if (process.env.GEMINI_API_KEY) {
      const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const res = await client.models.generateContent({
        model: "gemini-3.1-flash-lite-preview",
        contents: [{ role: "user", parts: [{ text: userMessage }] }],
        config: { systemInstruction: CLASSIFY_PROMPT },
      });
      text = res.text || "";
    } else {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const res = await client.messages.create({
        model: DEFAULT_ANTHROPIC_MODEL,
        max_tokens: 512,
        system: CLASSIFY_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      });
      text = (res.content.find((b) => b.type === "text") as Anthropic.TextBlock)?.text || "";
    }

    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return { mode: "simple" };

    const plan: Plan = JSON.parse(match[0]);
    if (plan.mode === "team" && Array.isArray(plan.tasks) && plan.tasks.length > 0) {
      const valid = plan.tasks.filter(
        (t) => t.agent in AGENTS && typeof t.task === "string" && t.task.length > 0
      );
      if (valid.length > 0) {
        console.log(`[AgentTeam] Plan: ${valid.map((t) => t.agent).join(" → ")}`);
        return { mode: "team", tasks: valid };
      }
    }

    return { mode: "simple" };
  } catch (err) {
    console.error("[AgentTeam] Classification error:", err);
    return { mode: "simple" };
  }
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

let cachedSkills: Skill[] | null = null;

function getSkills(): Skill[] {
  if (!cachedSkills) {
    cachedSkills = loadSkills(path.resolve(process.cwd()));
  }
  return cachedSkills;
}

function buildAgentSystemPrompt(agentDef: AgentDef, sharedContext: string): string {
  const skills = getSkills();

  // Filter skills for this agent
  const agentSkills = skills.filter((s) => {
    const targets = SKILL_AGENT_MAP[s.name];
    if (!targets) return true; // unmapped skills go to all agents
    return targets.includes(agentDef.name);
  });

  const skillContext = agentSkills.length > 0 ? buildSkillContext(agentSkills) : "";

  let prompt = agentDef.promptTemplate
    .replace("{skills}", skillContext)
    .replace("{schema}", agentDef.name === "db_researcher" ? getSchemaContext() : "");

  if (sharedContext) {
    prompt += `\n\n---\n\n## Kontext från tidigare agenter:\n${sharedContext}`;
  }

  prompt += "\n\nSvara alltid på svenska om inte annat anges.";

  return prompt;
}

function getToolsForAgent(agentDef: AgentDef, provider: LLMProvider): unknown[] {
  const toolNames =
    provider === "gemini" && agentDef.geminiOverrides?.toolNames
      ? agentDef.geminiOverrides.toolNames
      : agentDef.toolNames;

  return toolNames.filter((name) => name in TOOL_DEFS).map((name) => TOOL_DEFS[name][provider]);
}

// ---------------------------------------------------------------------------
// Cost tracking
// ---------------------------------------------------------------------------

interface CostAccumulator {
  inputTokens: number;
  outputTokens: number;
}

// ---------------------------------------------------------------------------
// Agent runners
// ---------------------------------------------------------------------------

async function* runAgentAnthropic(
  systemPrompt: string,
  task: string,
  tools: Anthropic.Tool[],
  model: string,
  sessionId: string | undefined,
  costs: CostAccumulator
): AsyncGenerator<LLMStreamEvent> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let messages: Anthropic.MessageParam[] = [{ role: "user", content: task }];

  // If no tools, do a single non-tool call
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
      yield {
        type: "tool_use",
        toolName: toolBlock.name,
        toolId: toolBlock.id,
        input: toolBlock.input as Record<string, unknown>,
      };

      const result = await executeTool(
        toolBlock.name,
        toolBlock.input as Record<string, unknown>,
        sessionId
      );

      if (result.artifact) {
        yield {
          type: "artifact",
          id: result.artifact.id,
          title: result.artifact.title,
          artifactType: result.artifact.type,
          content: result.artifact.content,
        };
      }

      if (result.files && result.files.length > 0) {
        yield { type: "files", files: result.files };
      }

      yield {
        type: "tool_result",
        toolId: toolBlock.id,
        success: result.success,
        summary: result.result.slice(0, 200),
      };

      toolResults.push({
        type: "tool_result",
        tool_use_id: toolBlock.id,
        content: result.result,
      });
    }

    messages = [
      ...messages,
      { role: "assistant", content: contentBlocks },
      { role: "user", content: toolResults },
    ];
  }
}

async function* runAgentGemini(
  systemPrompt: string,
  task: string,
  tools: unknown[],
  model: string,
  sessionId: string | undefined,
  costs: CostAccumulator,
  options?: { googleSearch?: boolean }
): AsyncGenerator<LLMStreamEvent> {
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const contents: Content[] = [{ role: "user", parts: [{ text: task }] }];

  // Build tools config — function declarations + optional Google Search grounding
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

        if (part.text) {
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
        yield {
          type: "artifact",
          id: result.artifact.id,
          title: result.artifact.title,
          artifactType: result.artifact.type,
          content: result.artifact.content,
        };
      }

      if (result.files && result.files.length > 0) {
        yield { type: "files", files: result.files };
      }

      yield {
        type: "tool_result",
        toolId,
        success: result.success,
        summary: result.result.slice(0, 200),
      };

      functionResponses.push({
        functionResponse: {
          name: fc.name,
          response: { result: result.result },
        },
      });
    }

    contents.push({ role: "user", parts: functionResponses });
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
  const userMessage = messages[messages.length - 1]?.content || "";
  const resolvedModel =
    model || (provider === "anthropic" ? DEFAULT_ANTHROPIC_MODEL : DEFAULT_GEMINI_MODEL);

  // --- Determine execution mode ---

  let plan: Plan;

  if (mode === "simple") {
    plan = { mode: "simple" };
  } else if (mode === "team") {
    yield { type: "agent_status" as LLMStreamEvent["type"], agent: "orchestrator", content: "Planerar uppgiften..." };
    plan = await classifyTask(userMessage, provider);
    if (plan.mode === "simple") {
      plan = {
        mode: "team",
        tasks: [{ agent: "db_researcher", task: userMessage }],
      };
    }
  } else {
    yield { type: "agent_status" as LLMStreamEvent["type"], agent: "orchestrator", content: "Analyserar uppgiften..." };
    plan = await classifyTask(userMessage, provider);
  }

  // --- Simple mode ---

  if (plan.mode === "simple") {
    const { streamLLM } = await import("./llm-provider");
    yield* streamLLM(provider, messages, model, sessionId);
    return;
  }

  // --- Team mode ---

  console.log(
    `[AgentTeam] Executing: ${plan.tasks!.map((t) => `${t.agent}("${t.task.slice(0, 50)}...")`).join(" → ")}`
  );

  let sharedContext = "";
  const costs: CostAccumulator = { inputTokens: 0, outputTokens: 0 };

  for (const task of plan.tasks!) {
    const agentDef = AGENTS[task.agent];

    yield {
      type: "agent_status" as LLMStreamEvent["type"],
      agent: agentDef.name,
      content: `${agentDef.emoji} ${agentDef.label}: ${task.task}`,
    };

    const systemPrompt = buildAgentSystemPrompt(agentDef, sharedContext);
    const tools = getToolsForAgent(agentDef, provider);

    const fullTask = [
      `## Användarens fråga`,
      userMessage,
      ``,
      `## Din uppgift`,
      task.task,
    ].join("\n");

    let agentOutput = "";

    // Per-agent model override (e.g. Pro for doc_designer)
    const agentModel =
      (provider === "gemini" ? agentDef.modelOverride?.gemini : agentDef.modelOverride?.anthropic)
      || resolvedModel;

    // Determine if this agent uses Google Search grounding
    const useGoogleSearch = provider === "gemini" && agentDef.geminiOverrides?.googleSearch;

    const runner =
      provider === "anthropic"
        ? runAgentAnthropic(systemPrompt, fullTask, tools as Anthropic.Tool[], agentModel, sessionId, costs)
        : runAgentGemini(systemPrompt, fullTask, tools, agentModel, sessionId, costs, {
            googleSearch: useGoogleSearch,
          });

    for await (const event of runner) {
      yield { ...event, agent: agentDef.name } as LLMStreamEvent;

      if (event.type === "text_delta" && event.content) {
        agentOutput += event.content;
      }
    }

    sharedContext += `\n\n### ${agentDef.emoji} ${agentDef.label}:\n${agentOutput}`;

    yield {
      type: "agent_status" as LLMStreamEvent["type"],
      agent: agentDef.name,
      content: `${agentDef.emoji} ${agentDef.label} klar`,
    };
  }

  yield {
    type: "done",
    cost: costs,
  };
}
