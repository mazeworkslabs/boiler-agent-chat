FROM node:20-alpine AS base
RUN apk add --no-cache curl python3 py3-pip \
    chromium nss freetype harfbuzz ca-certificates ttf-freefont
# Tell Playwright to use system Chromium instead of downloading its own
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser
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

# Writable dirs
RUN mkdir -p /app/uploads /tmp/chat-app-sandbox && \
    chown nextjs:nodejs /app/uploads /tmp/chat-app-sandbox

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["npx", "tsx", "server.ts"]
