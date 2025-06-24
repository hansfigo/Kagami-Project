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

WORKDIR /app/apps/telegram-bot

COPY --from=builder /app/package.json /app/pnpm-lock.yaml ./
COPY --from=builder /app/apps/telegram-bot/package.json ./package.json 

COPY --from=builder /app/apps/telegram-bot/dist ./dist

RUN npm install -g pnpm 
RUN pnpm install --prod 

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]