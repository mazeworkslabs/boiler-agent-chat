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
import {
  applyExecutionToSessionState,
  buildSessionStateContext,
  buildStructuredResultPayload,
  cloneSessionState,
  createNamedOutputsForResources,
  type SessionState,
} from "./session-state";

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
  "web_browser",
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
- web_browser: Visit specific URLs with a real browser (headless Chrome). Takes screenshots, extracts rendered content from JS-heavy sites/SPAs. Use when you have a URL and need a screenshot or rendered page content.
- analyst: Data analysis, charts, calculations with Python. Can read uploaded PDFs/images directly.
- doc_designer: Create/edit professional files (.pptx, .xlsx, .docx). Uses gemini-pro model. Can read uploaded PDFs.
- artifact_designer: Create interactive HTML dashboards shown in preview panel.

IMPORTANT: Prefer a structured handoff:
- objective: what the specialist should accomplish
- deliverable: the concrete output expected
- instructions: 2-6 concrete instructions
- successCriteria: what "done" means
- contextRefs: files, artifacts, facts, or outputs to use

Use task only as a legacy fallback.
If the user uploaded a PDF or image, mention that it's attached — the specialist can see it too.`,
  input_schema: {
    type: "object" as const,
    properties: {
      agent: {
        type: "string" as const,
        enum: SPECIALIST_NAMES as unknown as string[],
        description: "Which specialist to delegate to",
      },
      objective: {
        type: "string" as const,
        description: "What the specialist should accomplish for this user request",
      },
      deliverable: {
        type: "string" as const,
        description: "What concrete output the specialist should produce",
      },
      instructions: {
        type: "array" as const,
        items: { type: "string" as const },
        description: "2-6 concrete instructions for how to execute the handoff",
      },
      successCriteria: {
        type: "array" as const,
        items: { type: "string" as const },
        description: "Checks that define when the handoff is complete",
      },
      contextRefs: {
        type: "array" as const,
        items: { type: "string" as const },
        description: "Relevant files, artifacts, facts, or outputs the specialist should use",
      },
      preferredTools: {
        type: "array" as const,
        items: { type: "string" as const },
        description: "Preferred tools for this handoff when relevant",
      },
      maxToolCalls: {
        type: "integer" as const,
        description: "Approximate maximum number of tool calls the specialist should aim for",
      },
      task: {
        type: "string" as const,
        description: "Legacy fallback: free-text task description",
      },
    },
    required: ["agent"],
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
      objective: {
        type: "STRING" as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        description: "What the specialist should accomplish for this user request",
      },
      deliverable: {
        type: "STRING" as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        description: "What concrete output the specialist should produce",
      },
      instructions: {
        type: "ARRAY" as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        items: { type: "STRING" as any }, // eslint-disable-line @typescript-eslint/no-explicit-any
        description: "2-6 concrete instructions for how to execute the handoff",
      },
      successCriteria: {
        type: "ARRAY" as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        items: { type: "STRING" as any }, // eslint-disable-line @typescript-eslint/no-explicit-any
        description: "Checks that define when the handoff is complete",
      },
      contextRefs: {
        type: "ARRAY" as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        items: { type: "STRING" as any }, // eslint-disable-line @typescript-eslint/no-explicit-any
        description: "Relevant files, artifacts, facts, or outputs the specialist should use",
      },
      preferredTools: {
        type: "ARRAY" as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        items: { type: "STRING" as any }, // eslint-disable-line @typescript-eslint/no-explicit-any
        description: "Preferred tools for this handoff when relevant",
      },
      maxToolCalls: {
        type: "NUMBER" as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        description: "Approximate maximum number of tool calls the specialist should aim for",
      },
      task: {
        type: "STRING" as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        description: "Legacy fallback: free-text task description",
      },
    },
    required: ["agent"],
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
- Kontrollera senaste årtal först BARA om tabellen faktiskt har en year-/bokslutsaar-lik kolumn
- Om tabellen eller fälten är oklara: börja med EN schema-/preview-query, inte många breda keyword-sökningar
- Kör normalt högst 3-6 queries totalt och fråga inte efter samma underlag två gånger
- När du redan har relevanta rader: stoppa och sammanfatta i stället för att fortsätta utforska
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
    toolNames: ["web_search", "web_fetch"],
    geminiOverrides: { toolNames: [], googleSearch: true },
    promptTemplate: `Du söker information på webben.

VIKTIGT: Sök BARA det som uttryckligen efterfrågas. Om informationen redan finns i uppgiftsbeskrivningen — SÖK INTE efter den.

Leverera fakta med URL-källhänvisningar. Om du hittar relevanta URL:er som behöver besökas med en riktig webbläsare (t.ex. för screenshots), nämn dessa URL:er i ditt svar — lead-agenten kan delegera vidare till web_browser.

{skills}`,
  },

  web_browser: {
    name: "web_browser",
    label: "Webbläsare",
    emoji: "🖥️",
    toolNames: ["browse_web"],
    promptTemplate: `Du besöker webbsidor med en riktig webbläsare (headless Chrome via Playwright).

## Dina uppgifter
- Besök URL:er och ta screenshots (sätt screenshot: true)
- Extrahera renderat innehåll från JavaScript-tunga sidor och SPAs
- Vänta på specifika element om det behövs (wait_for parameter)

## Riktlinjer
- Ta ALLTID screenshots om inte uppgiften uttryckligen bara handlar om text
- Du kan besöka flera URL:er i sekvens
- Screenshot-filer sparas automatiskt och returneras som nedladdningsbara filer
- Om en URL inte fungerar, rapportera felet tydligt

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

function buildLeadAgentPrompt(
  sessionState?: SessionState,
  options?: { mode?: "auto" | "team" }
): string {
  const skills = getSkills();
  const skillContext = buildSkillContext(skills);
  const schemaContext = getSchemaContext();
  const sessionStateContext = sessionState ? buildSessionStateContext(sessionState) : "";
  const modeGuidance =
    options?.mode === "team"
      ? `\n## Team-läge\nDu är lead-agent i team-läge. För icke-triviala uppgifter ska du aktivt överväga att delegera till specialister, men bara när det faktiskt förbättrar resultatet.`
      : `\n## Auto-läge\nDu är lead-agent i auto-läge. Avgör själv om du ska svara direkt, använda vanliga verktyg eller delegera till specialister.`;

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
- web_browser — besöker URL:er med riktig webbläsare, tar screenshots, extraherar renderat innehåll
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

## KRITISKT: HTML och artifacts

Skriv ALDRIG HTML-kod som text i chatten. Om du behöver skapa/uppdatera en HTML-artifact:
- Använd create_artifact-verktyget (om det är enkelt)
- Eller delegera till artifact_designer (för komplexa dashboards)
HTML som skrivs som text blir oläslig för användaren!

## Redigering av befintliga artifacts

Du KAN redigera befintliga artifacts! När användaren trycker "Redigera" på en artifact skickas den befintliga HTML:en med i meddelandet inom <existing-artifact>-taggar. Så här fungerar det:

1. Meddelandet innehåller: [REDIGERA ARTIFACT: "titel"] + <existing-artifact>...hela HTML:en...</existing-artifact>
2. Du (eller artifact_designer) gör BARA de ändringar användaren ber om
3. Anropa create_artifact med den uppdaterade HTML:en — den ersätter den gamla

Om du ser [REDIGERA ARTIFACT] i meddelandet:
- För enkla ändringar (byta färg, text, lägga till element): gör det själv med create_artifact
- För komplexa ändringar: delegera till artifact_designer med den befintliga HTML:en + instruktionen

## Riktlinjer
- Svara alltid på svenska om inte användaren skriver på annat språk
- Var professionell, koncis och hjälpsam
- När du delegerar: inkludera ALL relevant kontext i task-beskrivningen
- När du använder delegate: fyll helst objective, deliverable, instructions, successCriteria och contextRefs i stället för en enda fri task-text
- Om du delegerat och fått tillbaka resultat: syntetisera och presentera snyggt för användaren
- Om användaren frågar vilken kod, query eller vilka steg som redan körts: svara direkt utifrån historiken och delegera inte samma sak igen om det inte verkligen saknas underlag
- Om användaren hänvisar till en specifik rapport, PDF eller fil men den inte finns i kontexten: be om filen i stället för att gissa eller fortsätta som om du hade den

${modeGuidance}

${sessionStateContext ? `${sessionStateContext}\n` : ""}
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
    + "\n\nDu far en strukturerad handoff med mal, leverabel, instruktioner, kontextreferenser och klart-nar-kriterier. Folj den strukturen och hall fokus pa precis den efterfragade leveransen.\n\nSvara alltid på svenska om inte annat anges.";
}

// ---------------------------------------------------------------------------
// Cost tracking
// ---------------------------------------------------------------------------

interface CostAccumulator {
  inputTokens: number;
  outputTokens: number;
}

type SpecialistName = typeof SPECIALIST_NAMES[number];

interface HandoffSpec {
  objective: string;
  deliverable: string;
  instructions: string[];
  successCriteria: string[];
  contextRefs: string[];
  preferredTools?: string[];
  maxToolCalls?: number;
  legacyTask?: string;
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}...`;
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const next: string[] = [];

  for (const item of value) {
    if (typeof item !== "string") continue;
    const cleaned = item.replace(/\s+/g, " ").trim();
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    next.push(cleaned);
  }

  return next;
}

function getDefaultDeliverable(agent: SpecialistName): string {
  switch (agent) {
    case "doc_designer":
      return "En färdig nedladdningsbar fil som uppfyller användarens krav.";
    case "artifact_designer":
      return "En färdig HTML-artifact som kan visas direkt i preview-panelen.";
    case "analyst":
      return "En användbar analys med beräkningar, nyckelinsikter och bara de filer/diagram som faktiskt behövs.";
    case "db_researcher":
      return "Ett kompakt, strukturerat dataunderlag från databasen med relevanta rader och fält.";
    case "api_researcher":
      return "Ett strukturerat underlag från externa API:er som kan användas direkt i nästa steg.";
    case "web_researcher":
      return "Ett kort researchunderlag med relevanta källor och tydliga slutsatser.";
    case "web_browser":
      return "Screenshots och/eller extraherat innehåll från de besökta webbsidorna.";
    default:
      return "Ett färdigt specialistunderlag som löser uppgiften.";
  }
}

function getDefaultMaxToolCalls(agent: SpecialistName): number {
  switch (agent) {
    case "db_researcher":
      return 6;
    case "analyst":
      return 5;
    case "api_researcher":
      return 5;
    case "web_researcher":
      return 4;
    case "web_browser":
      return 4;
    case "doc_designer":
      return 3;
    case "artifact_designer":
      return 2;
    default:
      return 4;
  }
}

function buildContextRefsFromSessionState(state: SessionState): string[] {
  const refs: string[] = [];

  for (const attachment of state.attachments.slice(-3)) {
    refs.push(`Bilaga: ${attachment.filename} (${attachment.mimeType})`);
  }

  for (const file of state.generatedFiles.slice(-4)) {
    refs.push(`Fil: ${file.filename} (${file.mimeType})`);
  }

  for (const artifact of state.artifacts.slice(-2)) {
    refs.push(`Artifact: ${artifact.title} (${artifact.type})`);
  }

  for (const output of state.namedOutputs.slice(-4)) {
    refs.push(`Output: ${output.label}`);
  }

  for (const fact of state.workingFacts.slice(-3)) {
    refs.push(`Faktum: ${truncateText(fact.text, 140)}`);
  }

  return cleanStringArray(refs).slice(0, 10);
}

function normalizeHandoffSpec(
  agent: SpecialistName,
  input: Record<string, unknown> | HandoffSpec | string,
  userMessage: string,
  sessionState: SessionState
): HandoffSpec {
  if (typeof input === "string") {
    return {
      objective: truncateText(input.replace(/\s+/g, " ").trim() || userMessage, 400),
      deliverable: getDefaultDeliverable(agent),
      instructions: [input],
      successCriteria: ["Lös användarens faktiska uppgift utan onödiga sidospår."],
      contextRefs: buildContextRefsFromSessionState(sessionState),
      preferredTools: SPECIALISTS[agent]?.toolNames || [],
      maxToolCalls: getDefaultMaxToolCalls(agent),
      legacyTask: input,
    };
  }

  const raw = input as Partial<HandoffSpec> & { task?: string };
  const fallbackTask =
    typeof raw.task === "string" && raw.task.trim().length > 0
      ? raw.task.trim()
      : undefined;
  const objective =
    typeof raw.objective === "string" && raw.objective.trim().length > 0
      ? raw.objective.trim()
      : fallbackTask || truncateText(userMessage.replace(/\s+/g, " ").trim(), 400);
  const instructions = cleanStringArray(raw.instructions);
  const successCriteria = cleanStringArray(raw.successCriteria);
  const contextRefs = cleanStringArray(raw.contextRefs);
  const preferredTools = cleanStringArray(raw.preferredTools);
  const maxToolCalls =
    typeof raw.maxToolCalls === "number" && Number.isFinite(raw.maxToolCalls)
      ? Math.max(1, Math.min(12, Math.floor(raw.maxToolCalls)))
      : getDefaultMaxToolCalls(agent);

  return {
    objective,
    deliverable:
      typeof raw.deliverable === "string" && raw.deliverable.trim().length > 0
        ? raw.deliverable.trim()
        : getDefaultDeliverable(agent),
    instructions:
      instructions.length > 0
        ? instructions
        : fallbackTask
          ? [fallbackTask]
          : ["Lös användarens uppgift med specialistens bästa verktyg och håll fokus på det uttryckliga målet."],
    successCriteria:
      successCriteria.length > 0
        ? successCriteria
        : ["Slutresultatet ska direkt matcha användarens efterfrågade leverabel."],
    contextRefs:
      contextRefs.length > 0
        ? contextRefs
        : buildContextRefsFromSessionState(sessionState),
    preferredTools: preferredTools.length > 0 ? preferredTools : SPECIALISTS[agent]?.toolNames || [],
    maxToolCalls,
    legacyTask: fallbackTask,
  };
}

function formatHandoffForSpecialist(handoff: HandoffSpec): string {
  const lines = [
    "## Handoff",
    `### Mål\n${handoff.objective}`,
    `### Förväntad leverans\n${handoff.deliverable}`,
  ];

  if (handoff.instructions.length > 0) {
    lines.push("### Instruktioner");
    for (const instruction of handoff.instructions) {
      lines.push(`- ${instruction}`);
    }
  }

  if (handoff.successCriteria.length > 0) {
    lines.push("### Klart när");
    for (const criterion of handoff.successCriteria) {
      lines.push(`- ${criterion}`);
    }
  }

  if (handoff.contextRefs.length > 0) {
    lines.push("### Kontextreferenser");
    for (const ref of handoff.contextRefs) {
      lines.push(`- ${ref}`);
    }
  }

  if (handoff.preferredTools && handoff.preferredTools.length > 0) {
    lines.push(`### Föredragna verktyg\n- ${handoff.preferredTools.join(", ")}`);
  }

  if (handoff.maxToolCalls != null) {
    lines.push(`### Verktygsbudget\n- Sikta på högst ${handoff.maxToolCalls} verktygsanrop om inte uppgiften tydligt kräver mer.`);
  }

  return lines.join("\n");
}

function summarizeHandoffForStatus(handoff: HandoffSpec): string {
  const summary = `${handoff.objective} -> ${handoff.deliverable}`;
  return truncateText(summary.replace(/\s+/g, " ").trim(), 120);
}


function getMissingAttachmentMessage(
  userMessage: string,
  sessionState: SessionState
): string | null {
  if (sessionState.attachments.length > 0) {
    return null;
  }

  const normalized = userMessage.toLowerCase();
  const referencesSpecificSource =
    /(bifogad|bilagd|uppladdad|medskickad|attached|attachment|pdf|rapporten|rapport\b|underlaget|dokumentet)/i.test(normalized)
    || (
      /(denna|den här|den har)/i.test(normalized)
      && /(pdf|rapport|underlag|dokument)/i.test(normalized)
    );
  const asksToUseSource =
    /(analysera|analys|läs|las|sammanfatta|utgå från|utga fran|basera|relatera|jämför|jamfor|kolla|checka|gå igenom|bearbeta|skapa|gör|gor)/i.test(normalized);

  if (!referencesSpecificSource || !asksToUseSource) {
    return null;
  }

  return "Du hänvisar till en specifik fil eller rapport, men jag ser ingen bifogad fil i den här chatten ännu. Bifoga filen så hjälper jag dig direkt.";
}

// ---------------------------------------------------------------------------
// Execute delegate — runs a specialist sub-agent and collects results
// ---------------------------------------------------------------------------

async function* executeDelegate(
  agentName: string,
  handoffInput: Record<string, unknown> | HandoffSpec | string,
  userMessage: string,
  provider: LLMProvider,
  model: string,
  sessionId: string | undefined,
  sessionState: SessionState,
  costs: CostAccumulator
): AsyncGenerator<LLMStreamEvent, ToolResult> {
  const resolvedAgentName = agentName as SpecialistName;
  const agentDef = SPECIALISTS[resolvedAgentName];
  if (!agentDef) {
    return { success: false, result: `Unknown specialist: ${agentName}` };
  }
  const handoff = normalizeHandoffSpec(resolvedAgentName, handoffInput, userMessage, sessionState);

  yield {
    type: "agent_status" as LLMStreamEvent["type"],
    agent: agentDef.name,
    content: `${agentDef.emoji} ${agentDef.label}: ${summarizeHandoffForStatus(handoff)}...`,
  };

  const systemPrompt = buildSpecialistPrompt(agentDef);

  // Specialist gets: a structured handoff + the original user message (for attachments)
  const sessionStateContext = buildSessionStateContext(sessionState);
  const fullTask = `${formatHandoffForSpecialist(handoff)}${sessionStateContext ? `\n\n${sessionStateContext}` : ""}\n\n## Ursprungligt meddelande från användaren\n${userMessage}`;

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
    yield { ...event, agent: agentDef.name } as LLMStreamEvent;

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

  yield {
    type: "agent_status" as LLMStreamEvent["type"],
    agent: agentDef.name,
    content: `${agentDef.emoji} ${agentDef.label} klar`,
  };

  const createdAt = new Date().toISOString();
  const summary = agentOutput.trim() || "(Specialisten returnerade inget textresultat)";
  const namedOutputs = createNamedOutputsForResources({
    sourcePrefix: agentDef.name,
    createdAt,
    artifact: collectedArtifact,
    files: collectedFiles,
  });

  return {
    success: true,
    result: buildStructuredResultPayload({
      type: "delegate",
      name: "delegate",
      agent: agentDef.name,
      success: true,
      summary,
      namedOutputs,
      artifact: collectedArtifact,
      files: collectedFiles,
    }),
    summary,
    namedOutputs,
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

      yield {
        type: "tool_result",
        toolName: toolBlock.name,
        toolId: toolBlock.id,
        success: result.success,
        summary: result.summary || result.result.slice(0, 200),
        namedOutputs: result.namedOutputs,
        facts: result.facts,
        resultKind: "tool",
      };

      toolResults.push({
        type: "tool_result",
        tool_use_id: toolBlock.id,
        content: buildStructuredResultPayload({
          type: "tool",
          name: toolBlock.name,
          success: result.success,
          summary: result.summary || result.result.slice(0, 200),
          details: result.result,
          namedOutputs: result.namedOutputs,
          facts: result.facts,
          artifact: result.artifact,
          files: result.files,
        }),
      });
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
    let isThinking = false;
    const functionCallParts: Array<{ name: string; args: Record<string, unknown> }> = [];
    const allParts: Part[] = [];
    let lastUsage: { promptTokenCount?: number; candidatesTokenCount?: number } = {};

    for await (const chunk of stream) {
      const candidate = chunk.candidates?.[0];
      if (!candidate?.content?.parts) continue;
      if (chunk.usageMetadata) lastUsage = chunk.usageMetadata;

      for (const part of candidate.content.parts) {
        allParts.push(part);
        if (part.thought) {
          if (!isThinking) { isThinking = true; yield { type: "thinking" }; }
          continue;
        }
        isThinking = false;
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

      yield {
        type: "tool_result",
        toolName: fc.name,
        toolId,
        success: result.success,
        summary: result.summary || result.result.slice(0, 200),
        namedOutputs: result.namedOutputs,
        facts: result.facts,
        resultKind: "tool",
      };

      functionResponses.push({
        functionResponse: {
          name: fc.name,
          response: {
            result: buildStructuredResultPayload({
              type: "tool",
              name: fc.name,
              success: result.success,
              summary: result.summary || result.result.slice(0, 200),
              details: result.result,
              namedOutputs: result.namedOutputs,
              facts: result.facts,
              artifact: result.artifact,
              files: result.files,
            }),
          },
        },
      });
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
  sessionState: SessionState,
  mode: "auto" | "team"
): AsyncGenerator<LLMStreamEvent> {
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const systemPrompt = buildLeadAgentPrompt(sessionState, { mode });
  let workingState = cloneSessionState(sessionState);

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
    let isThinking = false;
    const functionCallParts: Array<{ name: string; args: Record<string, unknown> }> = [];
    const allParts: Part[] = [];
    let lastUsage: { promptTokenCount?: number; candidatesTokenCount?: number } = {};

    for await (const chunk of stream) {
      const candidate = chunk.candidates?.[0];
      if (!candidate?.content?.parts) continue;
      if (chunk.usageMetadata) lastUsage = chunk.usageMetadata;

      for (const part of candidate.content.parts) {
        allParts.push(part);
        if (part.thought) {
          if (!isThinking) { isThinking = true; yield { type: "thinking" }; }
          continue;
        }
        isThinking = false;
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
        const delegateStream = executeDelegate(
          fc.args.agent as string,
          fc.args as Record<string, unknown>,
          userMessage,
          "gemini",
          model,
          sessionId,
          workingState,
          costs
        );

        while (true) {
          const next = await delegateStream.next();
          if (next.done) {
            result = next.value;
            break;
          }
          yield next.value;
        }
      } else {
        // --- Regular tool execution ---
        result = await executeTool(fc.name, fc.args, sessionId);
      }

      if (fc.name !== "delegate" && result.artifact) {
        yield { type: "artifact", id: result.artifact.id, title: result.artifact.title, artifactType: result.artifact.type, content: result.artifact.content };
      }
      if (fc.name !== "delegate" && result.files && result.files.length > 0) {
        yield { type: "files", files: result.files };
      }

      const summary = result.summary || result.result.slice(0, 200);
      yield {
        type: "tool_result",
        toolName: fc.name,
        toolId,
        success: result.success,
        summary,
        agent: fc.name === "delegate" ? (fc.args.agent as string) : undefined,
        namedOutputs: result.namedOutputs,
        facts: result.facts,
        resultKind: fc.name === "delegate" ? "delegate" : "tool",
      };

      workingState = applyExecutionToSessionState(workingState, {
        kind: fc.name === "delegate" ? "delegate" : "tool",
        toolName: fc.name,
        success: result.success,
        summary,
        agent: fc.name === "delegate" ? (fc.args.agent as string) : undefined,
        createdAt: new Date().toISOString(),
        namedOutputs: result.namedOutputs,
        facts: result.facts,
        artifact: result.artifact,
        files: result.files,
      });

      functionResponses.push({
        functionResponse: {
          name: fc.name,
          response: {
            result: buildStructuredResultPayload({
              type: fc.name === "delegate" ? "delegate" : "tool",
              name: fc.name,
              success: result.success,
              agent: fc.name === "delegate" ? (fc.args.agent as string) : undefined,
              summary,
              details: result.result,
              namedOutputs: result.namedOutputs,
              facts: result.facts,
              artifact: result.artifact,
              files: result.files,
            }),
          },
        },
      });
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
  sessionState: SessionState,
  mode: "auto" | "team"
): AsyncGenerator<LLMStreamEvent> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const systemPrompt = buildLeadAgentPrompt(sessionState, { mode });
  let workingState = cloneSessionState(sessionState);

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
        const input = toolBlock.input as Record<string, unknown> & { agent: string };
        const delegateStream = executeDelegate(
          input.agent,
          input,
          userMessage,
          "anthropic",
          model,
          sessionId,
          workingState,
          costs
        );

        while (true) {
          const next = await delegateStream.next();
          if (next.done) {
            result = next.value;
            break;
          }
          yield next.value;
        }
      } else {
        result = await executeTool(toolBlock.name, toolBlock.input as Record<string, unknown>, sessionId);
      }

      if (toolBlock.name !== "delegate" && result.artifact) {
        yield { type: "artifact", id: result.artifact.id, title: result.artifact.title, artifactType: result.artifact.type, content: result.artifact.content };
      }
      if (toolBlock.name !== "delegate" && result.files && result.files.length > 0) {
        yield { type: "files", files: result.files };
      }

      const summary = result.summary || result.result.slice(0, 200);
      yield {
        type: "tool_result",
        toolName: toolBlock.name,
        toolId: toolBlock.id,
        success: result.success,
        summary,
        agent: toolBlock.name === "delegate" ? ((toolBlock.input as { agent: string }).agent) : undefined,
        namedOutputs: result.namedOutputs,
        facts: result.facts,
        resultKind: toolBlock.name === "delegate" ? "delegate" : "tool",
      };

      workingState = applyExecutionToSessionState(workingState, {
        kind: toolBlock.name === "delegate" ? "delegate" : "tool",
        toolName: toolBlock.name,
        success: result.success,
        summary,
        agent: toolBlock.name === "delegate" ? ((toolBlock.input as { agent: string }).agent) : undefined,
        createdAt: new Date().toISOString(),
        namedOutputs: result.namedOutputs,
        facts: result.facts,
        artifact: result.artifact,
        files: result.files,
      });

      toolResults.push({
        type: "tool_result",
        tool_use_id: toolBlock.id,
        content: buildStructuredResultPayload({
          type: toolBlock.name === "delegate" ? "delegate" : "tool",
          name: toolBlock.name,
          success: result.success,
          agent: toolBlock.name === "delegate" ? ((toolBlock.input as { agent: string }).agent) : undefined,
          summary,
          details: result.result,
          namedOutputs: result.namedOutputs,
          facts: result.facts,
          artifact: result.artifact,
          files: result.files,
        }),
      });
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
  mode: AgentTeamMode = "auto",
  sessionState?: SessionState
): AsyncGenerator<LLMStreamEvent> {
  const resolvedModel =
    model || (provider === "anthropic" ? DEFAULT_ANTHROPIC_MODEL : DEFAULT_GEMINI_MODEL);

  // --- Simple mode: flat tool loop, no delegation ---
  if (mode === "simple") {
    const { streamLLM } = await import("./llm-provider");
    yield* streamLLM(provider, messages, model, sessionId, sessionState);
    return;
  }

  // --- Auto/Team mode: lead agent with delegation ---
  const costs: CostAccumulator = { inputTokens: 0, outputTokens: 0 };
  const resolvedState: SessionState = sessionState || {
    version: 2,
    sessionId: sessionId || "",
    latestUserMessage: messages[messages.length - 1]?.content || null,
    attachments: [],
    artifacts: [],
    generatedFiles: [],
    namedOutputs: [],
    workingFacts: [],
    recentToolResults: [],
    recentDelegateResults: [],
    timelineTurns: [],
  };
  const rawUserMessage = messages[messages.length - 1]?.content || "";
  const missingAttachmentMessage = getMissingAttachmentMessage(rawUserMessage, resolvedState);
  if (missingAttachmentMessage) {
    yield { type: "text_delta", content: missingAttachmentMessage };
    yield { type: "done", cost: costs };
    return;
  }

  const runner =
    provider === "anthropic"
      ? runLeadAgentAnthropic(messages, resolvedModel, sessionId, costs, resolvedState, mode)
      : runLeadAgentGemini(messages, resolvedModel, sessionId, costs, resolvedState, mode);

  yield* runner;

  yield { type: "done", cost: costs };
}
