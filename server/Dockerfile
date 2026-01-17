# JARVIS Server Dockerfile
# Multi-stage build for smaller final image

# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source
COPY . .

# Build
RUN npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S jarvis && \
    adduser -S jarvis -u 1001 -G jarvis

# Copy built files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Create data directories
RUN mkdir -p /app/data /app/logs && \
    chown -R jarvis:jarvis /app

# Switch to non-root user
USER jarvis

# Environment
ENV NODE_ENV=production
ENV DATABASE_PATH=/app/data/jarvis.db
ENV LOG_FILE=/app/logs/jarvis.log

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/api/v1/health || exit 1

# Start server
CMD ["node", "dist/index.js"]
