// ============================================================================
// NEW FILE: src/app/middlewares/rateLimiter.ts
// ----------------------------------------------------------------------------
// The README advertises "Express rate limiting" but there is NO rate limiter
// wired into app.ts. Under a 2k-user load test (and in real abuse), a single
// hot client or a retry storm can pile requests onto the event loop and the DB,
// inflating P95 for everyone. A limiter sheds that load cheaply.
//
// Uses the SAME Redis client you already have, so limits are shared across all
// PM2 cluster workers (an in-memory limiter would count per-worker and be
// effectively 4x looser). Requires: npm i rate-limit-redis express-rate-limit
// (express-rate-limit is likely already a dependency; add rate-limit-redis).
//
// If Redis is off, it automatically falls back to in-memory limiting.
// ============================================================================

import rateLimit from "express-rate-limit";
import { pubClient } from "../../config/redisClients";

// Only use the Redis store when Redis is actually connected.
const store =
  process.env.REDIS_URL && pubClient.isReady
    ? // Lazy require so the app still boots if the package isn't installed yet.
      (() => {
        try {
          const { RedisStore } = require("rate-limit-redis");
          return new RedisStore({
            sendCommand: (...args: string[]) => (pubClient as any).sendCommand(args),
          });
        } catch {
          return undefined; // falls back to in-memory
        }
      })()
    : undefined;

// General API limiter — generous, meant to catch abuse/storms, not normal use.
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,            // 120 req/min per IP — tune to your traffic
  standardHeaders: true,
  legacyHeaders: false,
  store,
  message: {
    success: false,
    message: "Too many requests, please slow down.",
  },
});

// Strict limiter for auth/OTP endpoints (brute-force protection).
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,                  // 20 attempts / 15 min per IP
  standardHeaders: true,
  legacyHeaders: false,
  store,
  message: {
    success: false,
    message: "Too many attempts, please try again later.",
  },
});

// ============================================================================
// WIRE INTO app.ts — add AFTER the body parsers / security middleware,
// BEFORE `app.use("/api/v1", router);`:
//
//   import { apiLimiter, authLimiter } from "./app/middlewares/rateLimiter";
//   ...
//   app.use("/api/v1/auth", authLimiter);   // strict on auth
//   app.use("/api/v1", apiLimiter);         // general on everything else
//
// Do NOT put a limiter on the Stripe webhook route (it's registered before
// this and must stay unthrottled).
// ============================================================================