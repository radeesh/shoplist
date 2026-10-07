# Multi-stage Dockerfile for ShopList Server
FROM node:20-alpine AS build

# Install build dependencies for better-sqlite3 compilation if needed
RUN apk add --no-cache python3 make g++ sqlite-dev

WORKDIR /app

# Install package dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Production runtime container
FROM node:20-alpine AS runner

WORKDIR /app

# Install runtime library for SQLite
RUN apk add --no-cache sqlite-libs wget

ENV NODE_ENV=production
ENV PORT=7821
ENV DATABASE_DIR=/app/data
ENV DATABASE_PATH=/app/data/shopping.db

# Copy node_modules and built code
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY db.js ./
COPY server.js ./
COPY public/ ./public/

# Create persistent data volume directory
RUN mkdir -p /app/data && chown -R node:node /app

USER node

EXPOSE 7821

# Health check configuration for Docker & Portainer
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:7821/api/health || exit 1

CMD ["node", "server.js"]
