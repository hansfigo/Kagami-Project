# --- Build Stage ---
FROM node:18-alpine AS builder

WORKDIR /app

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY turbo.json* ./


COPY apps/worker ./apps/worker

RUN pnpm install --frozen-lockfile
RUN pnpm --filter=worker build

# --- Production Stage ---
FROM node:18-alpine

WORKDIR /app/apps/worker

COPY --from=builder /app/package.json /app/pnpm-lock.yaml ./
COPY --from=builder /app/apps/worker/package.json ./package.json 

COPY --from=builder /app/apps/worker/dist ./dist

RUN npm install -g pnpm 
RUN pnpm install --prod 

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]