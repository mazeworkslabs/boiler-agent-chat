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

- **Frontend**: Next.js 16 App Router, Tailwind CSS 4, Geist fonts
- **Server**: Custom Express server with WebSocket (ws), runs via `tsx server.ts`
- **LLM**: Dual provider — Anthropic Claude + Google Gemini, switchable per-message
- **Database**: PostgreSQL via Drizzle ORM (5 databases: chat_app + 4 existing BF databases)
- **Auth**: Directus CMS BFF pattern (httpOnly cookies, proxy-login, proxy-refresh)
- **Sandbox**: Python (uv) + JavaScript (Node.js) code execution with file output
- **Skills**: YAML frontmatter auto-loaded from `.claude/skills/` and `.agents/skills/`

## Key files

| File | Purpose |
|------|---------|
| `server.ts` | Entry point: Express + Next.js + WebSocket upgrade routing |
| `server/llm-provider.ts` | Unified streaming for Anthropic + Gemini with tool-calling loops |
| `server/session-manager.ts` | Chat sessions, message persistence, artifact saving |
| `server/ws-server.ts` | WebSocket auth + message routing |
| `server/tools/` | Tool implementations: query_database, create_artifact, run_code, web_fetch, web_search |
| `server/skill-loader.ts` | Parses SKILL.md files and injects into LLM system prompt |
| `server/db/schema.ts` | Drizzle schema: sessions, messages, artifacts, generated_files |
| `src/components/chat/chat-panel.tsx` | Main chat UI with streaming, tool calls, file uploads |
| `public/assets/brand.json` | Brand colors, fonts, logo paths |

## Database

```bash
pnpm db:push    # Push schema to database
pnpm db:generate # Generate migrations
```

Schema in `server/db/schema.ts`. Local dev uses SSH tunnel (localhost:5433). Docker uses `postgres:5432` via `postgres_default` network.

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

Copy `.env.example` to `.env` on VPS and fill in:
- `POSTGRES_PASSWORD` — shared postgres password
- `GEMINI_API_KEY` — Google Gemini API key
- `ANTHROPIC_API_KEY` — Anthropic API key (optional)

### Docker notes

- Container joins `postgres_default` network to reach PostgreSQL
- `uploads` volume persists generated files across deploys
- Python sandbox uses `uv` (installed in image)
- JS sandbox uses npm (installed in image)
