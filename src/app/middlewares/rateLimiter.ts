import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { pubClient } from "../../config/redisClients";


// Only use the Redis store when Redis is actually connected.
// If the package isn't installed the import above will fail at build/boot
// time, so this stays undefined and the limiter falls back to in-memory.
const store =
  process.env.REDIS_URL && pubClient.isReady
    ? new RedisStore({
        sendCommand: (...args: string[]) => (pubClient as any).sendCommand(args),
      })
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
