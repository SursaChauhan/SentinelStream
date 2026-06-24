# backend/Dockerfile
#
# Multi-stage build for the Bun backend.
# Stage 1: install dependencies
# Stage 2: copy and run
#
# WHY multi-stage?
#   We don't need the full Bun installer in the final image.
#   Keeps the image smaller and cleaner.

FROM oven/bun:1.3-alpine AS base
WORKDIR /app

# Install dependencies first (separate layer so Docker caches them)
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile

# Copy source files
COPY . .

# Expose the port Bun listens on
EXPOSE 3000

# Start the server
CMD ["bun", "run", "src/index.ts"]
