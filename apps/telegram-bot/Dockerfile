# Use Node.js LTS version
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy root package.json and pnpm workspace files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy turbo.json if exists
COPY turbo.json* ./

# Copy all apps and packages for workspace dependencies
COPY apps ./apps
COPY packages ./packages

# Install dependencies using pnpm
RUN pnpm install --frozen-lockfile

# Build the worker app
RUN pnpm --filter=worker build

# Expose port (if needed for health checks)
EXPOSE 3000

# Set environment to production
ENV NODE_ENV=production

# Change to worker directory
WORKDIR /app/apps/worker

# Start the worker
CMD ["node", "dist/index.js"]