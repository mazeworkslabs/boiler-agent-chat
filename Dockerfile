FROM node:20-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl python3 python3-pip ca-certificates fonts-freefont-ttf && \
    rm -rf /var/lib/apt/lists/*
# Install uv for Python sandbox
RUN curl -LsSf https://astral.sh/uv/install.sh | sh && mv /root/.local/bin/uv /usr/local/bin/uv
# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# --- Dependencies ---
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# --- Builder ---
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# --- Runner ---
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Next.js standalone output
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Custom server files (TypeScript — run with tsx in prod)
COPY --from=builder /app/server.ts ./
COPY --from=builder /app/server ./server

# Skills for system prompt injection
COPY --from=builder /app/.claude/skills ./.claude/skills
COPY --from=builder /app/.agents/skills ./.agents/skills

# tsx for running TypeScript server in production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Install Playwright's bundled Chromium + system deps to a shared path accessible by nextjs user
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install --with-deps chromium && \
    chmod -R o+rx /ms-playwright

# Writable dirs + uv cache for Python sandbox
RUN mkdir -p /app/uploads /tmp/chat-app-sandbox /tmp/uv-cache && \
    chown nextjs:nodejs /app/uploads /tmp/chat-app-sandbox /tmp/uv-cache
ENV UV_CACHE_DIR=/tmp/uv-cache

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["npx", "tsx", "server.ts"]
