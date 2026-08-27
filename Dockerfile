# ============================================================================
# Dockerfile  —  PRODUCTION  (replaces your current Dockerfile)
# ============================================================================
# KEY FIX vs your current Dockerfile:
#   - HEALTHCHECK previously pinged http://api.rewaldo.com/health (an EXTERNAL
#     URL). That means the container's health didn't reflect ITS OWN state —
#     it could report healthy while broken, or unhealthy due to DNS/network.
#     Fixed to hit localhost:5004/health (the container checking itself).
#   - Builder stage keeps devDependencies (needed for `npm run build`).
#   - Production stage installs prod deps only (smaller, faster).
#   - connect-redis is a new runtime dep — it installs automatically because
#     it's added to package.json (see the guide's "npm install" step).
# ============================================================================

# ── Stage 1: Builder — install all deps & compile TypeScript ──
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
# Full install (incl devDependencies) for the TypeScript build
RUN npm install

COPY . .
RUN npm run build

# ── Stage 2: Production — lean runtime ──
FROM node:22-alpine AS production

# wget is used by the healthcheck; alpine has it via busybox already.
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY package*.json ./
# Production deps only — smaller image, fewer surprises
RUN npm install --omit=dev

RUN npm install -g pm2

# Compiled output from builder
COPY --from=builder /app/dist ./dist
COPY ecosystem.config.js ./

RUN mkdir -p uploads winston && chown -R appuser:appgroup /app

USER appuser

EXPOSE 5004

# ── FIXED HEALTHCHECK: check THIS container, not an external domain ──
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget -qO- http://localhost:5004/health || exit 1

CMD ["pm2-runtime", "start", "ecosystem.config.js"]