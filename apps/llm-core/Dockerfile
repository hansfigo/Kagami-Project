# apps/llm-core/Dockerfile
# --- Build Stage ---
FROM node:22-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy root package.json and pnpm workspace files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY turbo.json* ./

# Copy specific app (llm-core) and all shared packages it depends on
# Ini mengasumsikan llm-core mungkin butuh packages di folder 'packages'
COPY apps/llm-core ./apps/llm-core
# COPY packages ./packages 

# Install all dependencies (dev and prod) for the monorepo
RUN pnpm install --frozen-lockfile

RUN pnpm --filter=llm-core prisma generate

# Build the llm-core app using its build script
# Perintah build dari package.json llm-core: "build": "swc src -d dist --strip-leading-paths 1",
RUN pnpm --filter=llm-core build

# --- Production Stage ---
FROM node:22-alpine

WORKDIR /app/apps/llm-core

# Copy pnpm and package.json from builder for production dependency resolution
COPY --from=builder /app/package.json ./ 
COPY --from=builder /app/pnpm-lock.yaml ./ 
COPY --from=builder /app/apps/llm-core/package.json ./package.json 

# Install pnpm in production stage if it's not already there
RUN npm install -g pnpm

# Re-install only production dependencies for llm-core
# Ini akan membuat node_modules yang optimal untuk llm-core
RUN pnpm install --prod --filter=llm-core

# Copy built artifacts (dist folder)
COPY --from=builder /app/apps/llm-core/dist ./dist
COPY --from=builder /app/apps/llm-core/generated ./generated


# Expose the port where your LLM API will run (e.g., Elysia default 3000)
EXPOSE 3000 

# Set environment to production
ENV NODE_ENV=production

# Set the command to start your LLM-core app
# Perintah start dari package.json llm-core: "start": "node dist/index.js",
CMD ["node", "dist/index.js"]