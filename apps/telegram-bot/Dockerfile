# --- Build Stage ---
FROM node:18-alpine AS builder

WORKDIR /app

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY turbo.json* ./

COPY apps/telegram-bot ./apps/telegram-bot

RUN pnpm install --frozen-lockfile
RUN pnpm --filter=telegram-bot build

# --- Production Stage ---
FROM node:18-alpine

WORKDIR /app

# Copy workspace configuration
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./

# Copy telegram bot package.json
COPY --from=builder /app/apps/telegram-bot/package.json ./apps/telegram-bot/

# Copy built application
COPY --from=builder /app/apps/telegram-bot/dist ./apps/telegram-bot/dist

RUN npm install -g pnpm 
RUN pnpm install --prod --frozen-lockfile

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001
USER nextjs

ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "process.exit(0)" || exit 1

WORKDIR /app/apps/telegram-bot

CMD ["node", "dist/index.js"]