# API - Bun-based oRPC API with Drizzle ORM
FROM oven/bun:1-alpine

WORKDIR /app

# Install git for potential submodules
RUN apk add --no-cache git

# Copy package files first for better caching
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy the rest of the application
COPY . .

# Default port
ENV PORT=3001

EXPOSE 3001

CMD ["bun", "--bun", "run", "src/server.ts"]