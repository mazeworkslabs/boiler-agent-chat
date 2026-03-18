# Chat App — Business Falkenberg AI Assistant

## Quick start

```bash
# Install dependencies
pnpm install

# Start dev server (Express + Next.js + WebSocket)
pnpm dev

# Local dev requires SSH tunnel for PostgreSQL:
ssh -L 5433:127.0.0.1:5433 glsfbg -N
```

## Architecture

- **Frontend**: Next.js 16 App Router, Tailwind CSS 4, Geist fonts, monochrome UI
- **Server**: Custom Express server with WebSocket (ws), runs via `tsx server.ts`
- **LLM**: Dual provider — Anthropic Claude + Google Gemini, switchable per-message
- **Agent Team**: 7 specialized agents with orchestrator (auto/team/simple modes)
- **Database**: PostgreSQL via Drizzle ORM (3 external DBs: fbg_analytics, naringslivsklimat, fbg_planning + chat_app own DB)
- **Auth**: Directus CMS BFF pattern (httpOnly cookies, proxy-login, proxy-refresh)
- **Sandbox**: Python (uv) + JavaScript (Node.js) code execution with file output. Agents can edit existing files.
- **Skills**: YAML frontmatter auto-loaded from `.claude/skills/` and `.agents/skills/`
- **Cron**: Monthly job data refresh via `/api/cron/refresh-jobs`

## Agent Team (server/agent-team.ts)

Lead agent with delegation to 7 specialists:

| Agent | Tools | Role |
|-------|-------|------|
| `db_researcher` | query_database | Internal data (has full DB schema injected at startup) |
| `api_researcher` | run_code | External APIs (SCB PxWeb etc.) via Python |
| `web_researcher` | web_search, web_fetch (Gemini: Google Search grounding) | Search the web for news, reports, qualitative info |
| `web_browser` | browse_web | Visit URLs with headless Chrome, take screenshots, extract rendered content |
| `analyst` | run_code | Data analysis, charts, calculations |
| `doc_designer` | run_code (gemini-3.1-pro-preview) | .pptx, .xlsx, .docx files. Can edit existing files |
| `artifact_designer` | create_artifact | Interactive HTML dashboards in preview panel |

Modes (toggle in UI): **Chat** (flat loop), **Auto** (orchestrator decides), **Team** (force agent team)

## Key files

| File | Purpose |
|------|---------|
| `server.ts` | Entry point: Express + Next.js + WebSocket + schema cache init |
| `server/agent-team.ts` | Agent team: 7 agents, orchestrator, skill routing, Gemini grounding |
| `server/llm-provider.ts` | Unified streaming for Anthropic + Gemini with tool-calling loops |
| `server/session-manager.ts` | Chat sessions, message persistence, artifact saving |
| `server/ws-server.ts` | WebSocket auth + message routing |
| `server/db/schema-cache.ts` | Startup introspection of all DB schemas for db_researcher |
| `server/tools/query-database.ts` | SQL queries against 3 DBs (fbg_analytics, naringslivsklimat, fbg_planning) |
| `server/tools/run-code.ts` | Python/JS sandbox. Detects new AND modified files (mtime). Copies session files in for editing |
| `server/tools/create-artifact.ts` | HTML/SVG/Markdown artifacts shown in preview panel |
| `server/tools/browse-web.ts` | Playwright headless Chrome with fetch fallback + screenshots |
| `server/tools/web-tools.ts` | web_fetch + web_search (DuckDuckGo) |
| `server/skill-loader.ts` | Parses SKILL.md files and injects into agent system prompts |
| `src/components/chat/chat-panel.tsx` | Chat UI: streaming, tool calls, agent status, abort, image lightbox |
| `src/components/artifact/artifact-panel.tsx` | Artifact viewer: preview, edit, navigate, download, open in new tab |
| `scripts/backfill-jobs.ts` | One-time: fill historical job data gaps via Historical API + Gemini classification |

## Skills (.agents/skills/)

| Skill | Routed to |
|-------|-----------|
| `database-query` | db_researcher |
| `scb-api` | api_researcher |
| `grafisk-profil` | doc_designer, artifact_designer |
| `pptx` | doc_designer |
| `docx` | doc_designer |
| `xlsx` | doc_designer |
| `pdf` | doc_designer |

## Gemini models (ONLY use these)

- `gemini-3.1-flash-lite-preview` — classification/routing (cheapest)
- `gemini-3-flash-preview` — workhorse agent model
- `gemini-3.1-pro-preview` — doc_designer (complex code generation)

## Database

```bash
pnpm db:push    # Push schema to database
pnpm db:generate # Generate migrations
```

3 external databases (scb_data removed — use api_researcher for fresh SCB data):
- **fbg_analytics**: company_financials, job_postings, job_classification_stats, scb_employment_stats
- **naringslivsklimat**: 14 municipalities (Göteborg→Malmö), 24+ KPIs, income distribution, housing, leading indicators
- **fbg_planning**: activities, focus_areas, strategic_concepts (Århjulet)

Schema cached at startup (`server/db/schema-cache.ts`) and injected into db_researcher's system prompt.

## Deployment

Runs on VPS in Docker (port 3006 → 3000). Caddy reverse proxy at `chat.businessfalkenberg.se`.

```bash
ssh glsfbg
cd chat-app
git pull
docker compose down
docker compose up -d --build
```

### Environment

Key env vars (`.env` on VPS):
- `GEMINI_API_KEY` — Google Gemini API key
- `ANTHROPIC_API_KEY` — Anthropic API key (optional)
- `CRON_SECRET` — Shared secret for cron endpoints
- `DATABASE_URL` — chat_app DB
- `DATABASE_URL_FBG_ANALYTICS` — fbg_analytics DB
- `DATABASE_URL_NARINGSLIVSKLIMAT` — naringslivsklimat DB
- `DATABASE_URL_FBG_PLANNING` — fbg_planning DB

### Cron (VPS)

Monthly at 03:00 on 1st (`~/refresh-data.sh`):
1. `naringslivsklimat/api/refresh/all` — KPIs, income, housing, leading indicators
2. `chat-app/api/cron/refresh-jobs` — JobStream API + Gemini Flash Lite classification

### Docker notes

- Container joins `postgres_default` network to reach PostgreSQL
- `uploads` volume persists generated files across deploys
- Python sandbox uses `uv` (installed in image)
- Playwright available for browse_web tool (fallback to fetch if browsers not installed)
