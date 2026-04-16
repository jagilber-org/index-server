###############################################################################
# Stage 1: Build — compile TypeScript and install production dependencies
###############################################################################
FROM node:22-alpine AS build

WORKDIR /app

# Copy dependency manifests first (layer caching)
COPY package.json package-lock.json ./

# Install ALL dependencies (dev included for tsc)
RUN npm ci --ignore-scripts

# Copy source
COPY tsconfig.json ./
COPY src/ ./src/
COPY schemas/ ./schemas/
COPY constitution.json ./

# Build TypeScript
RUN npx tsc -p tsconfig.json

# Copy dashboard assets (if present)
COPY scripts/copy-dashboard-assets.mjs ./scripts/
RUN node scripts/copy-dashboard-assets.mjs 2>/dev/null || true

# Prune to production-only dependencies
RUN npm prune --omit=dev && \
    rm -rf scripts/ src/ tsconfig.json

###############################################################################
# Stage 2: Runtime — minimal, hardened production image
###############################################################################
FROM node:22-alpine AS runtime

# Security: tini for PID 1 signal handling, openssl for TLS cert generation
RUN apk add --no-cache tini openssl && \
    apk upgrade --no-cache

# OCI labels
LABEL org.opencontainers.image.title="index-server" \
      org.opencontainers.image.description="MCP instruction indexing server for AI assistant governance" \
      org.opencontainers.image.source="https://github.com/jagilber-org/index-server" \
      org.opencontainers.image.licenses="MIT"

WORKDIR /app

# Copy built artifacts from build stage
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./
COPY --from=build /app/schemas ./schemas
COPY --from=build /app/constitution.json ./

# Copy instruction bundle if present (can be overridden via volume mount)
# instructions/ is gitignored in source; may not exist in clean clones.
# Use a dummy Dockerfile trick: COPY with a known file + optional dir.
COPY package.json instructions* /tmp/staging/
RUN mkdir -p /app/instructions && \
    if [ -d /tmp/staging/instructions ]; then \
      cp -r /tmp/staging/instructions/* /app/instructions/ 2>/dev/null || true; \
    fi && \
    rm -rf /tmp/staging

# Create data directories with correct permissions
RUN mkdir -p /app/data /app/logs /app/metrics /app/feedback /app/governance /app/certs && \
    chown -R node:node /app

# Volume mount points
VOLUME ["/app/certs", "/app/data", "/app/instructions"]

# Environment defaults.
# The dashboard binds to 0.0.0.0 inside the container so published ports work.
# Limit host exposure via compose or runtime port binding instead.
ENV NODE_ENV=production \
    INDEX_SERVER_DIR=/app/instructions \
    INDEX_SERVER_DASHBOARD=1 \
    INDEX_SERVER_DASHBOARD_PORT=8787 \
    INDEX_SERVER_DASHBOARD_HOST=0.0.0.0 \
    INDEX_SERVER_LOG_LEVEL=info \
    INDEX_SERVER_METRICS_DIR=/app/metrics \
    INDEX_SERVER_FEEDBACK_DIR=/app/feedback \
    INDEX_SERVER_MUTATION=0

# Expose dashboard port
EXPOSE 8787

# Health check — dashboard status endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:${INDEX_SERVER_DASHBOARD_PORT:-8787}/api/status || exit 1

# Drop to non-root
USER node

# Tini as PID 1 for proper signal propagation
ENTRYPOINT ["/sbin/tini", "--"]

CMD ["sh", "-c", "tail -f /dev/null | node dist/server/index-server.js --dashboard"]
