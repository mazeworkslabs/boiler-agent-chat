# Boiler Agent Chat — White-Label Setup Guide

> How to deploy this multi-agent AI assistant for any organization.
> Reference implementation: [cryptonicsurfer/chat-app](https://github.com/cryptonicsurfer/chat-app)

---

## What This App Does

A full-stack AI assistant with:
- **7 specialist agents** (database, API, web search, browser, analyst, document designer, artifact designer) orchestrated by a lead agent
- **Dual LLM support** — Anthropic Claude + Google Gemini, switchable per message
- **Code sandbox** — Python (uv) + JavaScript execution with file output
- **Document generation** — .pptx, .xlsx, .docx, .pdf via code execution
- **Interactive artifacts** — HTML/SVG dashboards in a preview panel
- **Web browsing** — Playwright headless Chrome with screenshots
- **Auth** — Directus CMS BFF pattern (httpOnly cookies)
- **PostgreSQL** — Drizzle ORM, multi-database support
- **Real-time** — WebSocket streaming with agent status updates

---

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│  Next.js 16 App Router (Frontend)               │
│  - Chat UI with streaming                       │
│  - Artifact preview panel                       │
│  - Workspace modal (files, data, facts)         │
│  - Sidebar with session history                 │
└────────────────┬────────────────────────────────┘
                 │ WebSocket + REST
┌────────────────▼────────────────────────────────┐
│  Express Server (server.ts)                     │
│  - WebSocket auth + message routing             │
│  - Session management (PostgreSQL)              │
│  - Agent team orchestration                     │
│  - Tool execution (code, browse, query, etc.)   │
│  - Skill loader (YAML frontmatter)              │
└────────────────┬────────────────────────────────┘
                 │
    ┌────────────┼────────────────┐
    ▼            ▼                ▼
 Claude API   Gemini API    PostgreSQL (N databases)
```

---

## Step-by-Step: Deploy for a New Organization

### 1. Environment Variables

Create `.env` with these required variables:

```bash
# === LLM Providers (at least one required) ===
ANTHROPIC_API_KEY=sk-ant-...        # Claude API key
GEMINI_API_KEY=AIza...              # Google Gemini API key

# === App Database (required) ===
DATABASE_URL=postgresql://user:pass@host:port/chat_app

# === External Databases (optional — remove agents if not needed) ===
# Add one DATABASE_URL_<NAME> per external database you want agents to query
DATABASE_URL_COMPANY_DATA=postgresql://user:pass@host:port/company_data
DATABASE_URL_ANALYTICS=postgresql://user:pass@host:port/analytics

# === Authentication ===
DIRECTUS_URL=https://your-cms.example.com   # Directus CMS instance URL

# === Cron (optional) ===
CRON_SECRET=some-random-secret              # Protects /api/cron/* endpoints
```

**What to change:**
| Current (Falkenberg) | Your version |
|---|---|
| `DATABASE_URL_FBG_ANALYTICS` | `DATABASE_URL_<YOUR_DB_NAME>` |
| `DATABASE_URL_NARINGSLIVSKLIMAT` | Remove or replace |
| `DATABASE_URL_FBG_PLANNING` | Remove or replace |
| `cms.businessfalkenberg.se` | Your Directus instance |

---

### 2. Database Configuration

#### Files to modify:

**`server/db/schema-cache.ts`** — Maps env vars to database names for agent introspection.

```typescript
// CURRENT (Falkenberg-specific):
const DATABASES: Record<string, string> = {
  fbg_analytics: process.env.DATABASE_URL_FBG_ANALYTICS!,
  naringslivsklimat: process.env.DATABASE_URL_NARINGSLIVSKLIMAT!,
  fbg_planning: process.env.DATABASE_URL_FBG_PLANNING!,
};

// YOUR VERSION:
const DATABASES: Record<string, string> = {
  company_data: process.env.DATABASE_URL_COMPANY_DATA!,
  analytics: process.env.DATABASE_URL_ANALYTICS!,
  // Add/remove as needed
};
```

**`server/tools/query-database.ts`** — Database enum in tool definition + pool creation.

```typescript
// Update the database enum to match your DATABASES keys:
database: { type: "string", enum: ["company_data", "analytics"] }

// Update pool map to match:
const pools: Record<string, Pool> = {
  company_data: new Pool({ connectionString: process.env.DATABASE_URL_COMPANY_DATA }),
  analytics: new Pool({ connectionString: process.env.DATABASE_URL_ANALYTICS }),
};
```

**`docker-compose.yml`** — Pass your database URLs as environment variables.

---

### 3. Agent Team — System Prompts

**File: `server/agent-team.ts`**

This is the most important file to customize. Each agent has a system prompt that defines its personality and domain knowledge.

#### Lead Agent (the orchestrator)

```typescript
// Line ~403 — Replace entirely with your company context:
const leadSystemPrompt = `
Du är en AI-assistent för ${COMPANY_NAME}.
Du hjälper medarbetare med ${COMPANY_DESCRIPTION}.
...
`;
```

**Key things to replace in the lead prompt:**
- Company name and description
- Municipality/region ID (currently `1382` for Falkenberg)
- Database names and what they contain
- Which specialists exist and what they do
- Language (currently Swedish)

#### Specialist Agents

| Agent | What to customize |
|---|---|
| `db_researcher` | System prompt references specific DB schemas. Schema is auto-injected at startup from `schema-cache.ts`, but the prompt text describing the databases needs updating |
| `api_researcher` | References SCB (Swedish statistics bureau). Replace with your country/region's data APIs |
| `web_researcher` | Generic — works as-is |
| `web_browser` | Generic — works as-is |
| `analyst` | Color palette hardcoded (`#1B5E7B` etc.). Update to your brand colors |
| `doc_designer` | References "Business Falkenbergs grafiska profil". Update brand reference |
| `artifact_designer` | Color palette hardcoded. Update to your brand colors |

---

### 4. Skills (`.agents/skills/` and `.claude/skills/`)

Skills are YAML frontmatter files that get auto-loaded and injected into agent system prompts. They define domain-specific knowledge.

#### Skills to replace:

| Skill | Path | What it does | Action |
|---|---|---|---|
| `grafisk-profil` | `.agents/skills/grafisk-profil/SKILL.md` | Falkenberg visual identity (colors, logos, fonts) | **Replace** with your brand guidelines |
| `scb` | `.agents/skills/scb/SKILL.md` | Swedish statistics API documentation | **Replace** with your data source APIs, or **remove** |
| `database-query` | `.claude/skills/database-query/SKILL.md` | DB schema descriptions + query examples | **Replace** with your database schemas |
| `pptx` | `.agents/skills/pptx/SKILL.md` | PowerPoint generation with Falkenberg colors | **Update** color constants and logo paths |
| `docx` | `.agents/skills/docx/SKILL.md` | Word document generation | Generic — likely works as-is |
| `xlsx` | `.agents/skills/xlsx/SKILL.md` | Excel generation | Generic — likely works as-is |
| `pdf` | `.agents/skills/pdf/SKILL.md` | PDF generation | Generic — likely works as-is |

#### Adding new skills:

Create `SKILL.md` in `.agents/skills/<skill-name>/` with:

```yaml
---
name: my-skill
description: What this skill does
agents: [db_researcher, analyst]  # Which agents get this injected
globs: ["**/*.py"]                # Optional file patterns
---

Your skill content here (markdown).
The text below the frontmatter gets injected into the agent's system prompt.
```

**Important architecture note:** The lead agent only sees skill **summaries** (name + description + which specialist owns it), NOT the full skill content. This keeps the lead agent focused on delegation. Full skill content is only injected into the mapped specialist agents. This is handled by `buildSkillSummary()` in `server/skill-loader.ts`.

---

### 5. UI Branding

#### App metadata

**`src/app/layout.tsx`**
```typescript
// Line 15-18:
title: "Your Company AI",
description: "AI assistant for Your Company",

// Line 26 — language:
<html lang="en">  // or "sv", "de", etc.
```

#### Login page

**`src/app/login/page.tsx`**
```typescript
// Line 43:
<h1>Your Company AI</h1>

// Line 62 — email placeholder:
placeholder="name@yourcompany.com"
```

#### Sidebar logo

**`src/components/sidebar/app-sidebar.tsx`**
```typescript
// Lines 125-131 — Replace logo paths:
src="/assets/logos/your-logo.png"
alt="Your Company"
```

#### Brand assets

**`public/assets/brand.json`** — Complete brand definition used by agents:
```json
{
  "name": "Your Company",
  "colors": {
    "primary": "#YOUR_PRIMARY",
    "secondary": "#YOUR_SECONDARY",
    "accent": "#YOUR_ACCENT"
  },
  "fonts": {
    "heading": "Your Heading Font",
    "body": "Your Body Font"
  },
  "logos": {
    "horizontal_black": "/assets/logos/logo-black.png",
    "horizontal_white": "/assets/logos/logo-white.png"
  }
}
```

**`public/assets/logos/`** — Replace all logo files with your company logos.

**`public/app-logo.png`** — App icon shown in browser tab.

---

### 6. External API Integrations

#### Job postings (optional — Falkenberg-specific)

**`src/app/api/cron/refresh-jobs/route.ts`**
- Currently fetches from Swedish Employment Agency (Arbetsförmedlingen) for Falkenberg
- Location ID `qaJg_wMR_C8T` is Falkenberg-specific
- **Action:** Replace with your regional job data source, or remove entirely

**`scripts/backfill-jobs.ts`**
- Municipality code `1382` hardcoded
- **Action:** Update or remove

#### Authentication

Auth proxy routes fall back to `https://cms.businessfalkenberg.se` if `DIRECTUS_URL` is not set. As long as you set `DIRECTUS_URL` in your environment, these work for any Directus instance. Files:
- `src/app/api/auth/directus-proxy-login/route.ts`
- `src/app/api/auth/directus-proxy-refresh/route.ts`
- `src/app/api/auth/check/route.ts`

---

### 7. Docker Deployment

**`docker-compose.yml`** — Update environment variables:
```yaml
environment:
  - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
  - GEMINI_API_KEY=${GEMINI_API_KEY}
  - DATABASE_URL=${DATABASE_URL}
  - DATABASE_URL_COMPANY_DATA=${DATABASE_URL_COMPANY_DATA}
  - DIRECTUS_URL=${DIRECTUS_URL}
  - CRON_SECRET=${CRON_SECRET}
```

**`Dockerfile`** — Generic, no changes needed. Includes:
- Node.js 20 (Debian bookworm-slim)
- Python + uv (for code sandbox)
- Playwright + Chromium (for web browsing)
- pnpm for package management

**Deploy:**
```bash
docker compose up -d --build
```

The app runs on port 3000 inside the container. Put a reverse proxy (Caddy, nginx) in front for SSL.

---

### 8. Removing Agents You Don't Need

If you don't have external databases, you can simplify the agent team:

**`server/agent-team.ts`:**
1. Remove the agent from `SPECIALIST_NAMES` array
2. Remove its entry from the `specialists` map
3. Update the lead agent's prompt to not mention it
4. Remove corresponding tools if unused

**Minimum viable setup** (no external DBs, no regional APIs):
- Keep: `web_researcher`, `web_browser`, `analyst`, `doc_designer`, `artifact_designer`
- Remove: `db_researcher`, `api_researcher`
- Remove: `server/tools/query-database.ts`, `server/db/schema-cache.ts`

---

## Quick Checklist

- [ ] Set up `.env` with your API keys and database URLs
- [ ] Update `server/db/schema-cache.ts` with your database names
- [ ] Update `server/tools/query-database.ts` database enum and pools
- [ ] Rewrite agent system prompts in `server/agent-team.ts`
- [ ] Replace/update skills in `.agents/skills/` and `.claude/skills/`
- [ ] Update `src/app/layout.tsx` — title, description, language
- [ ] Update `src/app/login/page.tsx` — company name, email placeholder
- [ ] Replace logos in `public/assets/logos/` and update `app-sidebar.tsx`
- [ ] Update `public/assets/brand.json` with your brand
- [ ] Update `docker-compose.yml` environment variables
- [ ] Remove or replace Falkenberg-specific cron jobs
- [ ] Set up Directus CMS instance (or swap auth to your own system)
- [ ] Deploy with `docker compose up -d --build`
- [ ] Configure reverse proxy (Caddy/nginx) with SSL

---

## Architecture Decisions Worth Knowing

1. **Skill system is plug-and-play** — Drop a `SKILL.md` in `.agents/skills/<name>/` and it auto-loads. Great for adding domain knowledge without touching code.

2. **Schema introspection is automatic** — `schema-cache.ts` reads all table/column info at startup and injects it into the db_researcher's prompt. Just point it at your databases.

3. **Code sandbox is isolated** — Python runs via `uv` in `/tmp/chat-app-sandbox/`, JavaScript via Node.js child process. Generated files are saved to `uploads/` and served via `/api/serve-file/:id`.

4. **Gemini Google Search grounding** — `web_researcher` uses Gemini's built-in Google Search grounding (no function calling). `web_browser` uses Playwright tools. They can't be combined in one agent due to Gemini API limitations.

5. **Session state tracks everything** — Artifacts, generated files, named outputs, working facts, and delegate results are all tracked per session and displayed in the workspace modal.

6. **Multi-model per message** — Users can toggle between Claude and Gemini in the UI. The agent team uses the selected model for the lead agent; specialists may use different models (e.g., doc_designer uses Gemini Pro for complex code gen).
