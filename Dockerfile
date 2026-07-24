# ============================================================
# Stage 1: Builder — Install deps & compile TypeScript
# ============================================================
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./

# Install ALL dependencies (including devDependencies for build)
# npm ci is used instead of "npm install" for reproducible, lockfile exact install in CI/CD
RUN npm install

COPY . .

# Compile TypeScript → dist/
RUN npm run build

# ============================================================
# Stage 2: Production — Lean runtime image
# ============================================================
FROM node:22-alpine AS production

# Create a non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY package*.json ./

RUN npm install

# Copy compiled JS from builder stage
COPY --from=builder /app/dist ./dist

# Copy ecosystem config for PM2
COPY ecosystem.config.js ./

# Create uploads directory (needed at runtime for file uploads)
RUN mkdir -p uploads && chown -R appuser:appgroup /app

# Switch to non-root user
USER appuser

# Expose the application port
EXPOSE 5004

# Health check — ensures container is healthy before traffic is routed
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
CMD wget -qO- http://localhost:5004/health || exit 1

# Start with Node directly (PM2 is used on the host via ecosystem.config.js)
CMD ["node", "dist/server.js"]
