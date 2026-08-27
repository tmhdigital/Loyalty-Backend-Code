// ============================================================================
// src/config/redisClients.ts  —  REPLACE the whole file with this.
// ----------------------------------------------------------------------------
// WHY THIS CHANGED
//   The previous version created pubClient/subClient with NO event handlers.
//   In node-redis v4+ this is dangerous: if any error fires (a transient
//   network blip, a reconnect, DNS, auth) and there is no 'error' listener,
//   the error is either swallowed or can crash the process — and isReady can
//   silently stay false. Because app.ts, server.ts and the rate limiter all
//   guard on `pubClient.isReady`, a silently-not-ready client makes EVERY
//   Redis feature (auth cache, session store, rate limiter, socket adapter)
//   fall back to in-memory WITHOUT a single log line. That is exactly what was
//   happening in production (DBSIZE was 0 — nothing was ever written).
//
//   This version:
//     - attaches 'error' / 'connect' / 'ready' / 'reconnecting' / 'end'
//       listeners on BOTH clients, so the connection state is always visible
//       in logs and a stray error can never take the process down silently.
//     - adds a bounded reconnect strategy (won't hammer forever).
//     - keeps the SAME exports (pubClient, subClient, connectRedis) so no
//       other file needs to change.
// ============================================================================

import { createClient } from "redis";
import config from "./index";
import { logger } from "../shared/logger";

// Bounded exponential backoff: 100ms, 200ms ... capped at 3s. After ~10
// failed attempts we stop retrying so a dead Redis doesn't spin forever.
const reconnectStrategy = (retries: number): number | Error => {
  if (retries > 10) {
    logger.error("Redis: giving up after 10 reconnect attempts");
    return new Error("Redis reconnect attempts exhausted");
  }
  const delay = Math.min(100 * 2 ** retries, 3000);
  logger.warn(`Redis: reconnect attempt ${retries + 1} in ${delay}ms`);
  return delay;
};

export const pubClient = createClient({
  url: config.redis_url,
  socket: {
    reconnectStrategy,
    connectTimeout: 10000,
  },
});

// subClient MUST be a duplicate of pubClient (shared config) for the
// Socket.IO Redis adapter to work correctly.
export const subClient = pubClient.duplicate();

// ── Attach listeners to BOTH clients so no error is ever unhandled ──────────
const wire = (client: typeof pubClient, name: string) => {
  client.on("error", (err) => {
    // This is the line that was missing. Without it, a single error could
    // wedge the client with isReady=false and never surface a reason.
    logger.error(`Redis [${name}] error: ${err?.message}`);
  });
  client.on("connect", () => logger.info(`Redis [${name}] connecting…`));
  client.on("ready", () => logger.info(`Redis [${name}] ready ✅`));
  client.on("reconnecting", () => logger.warn(`Redis [${name}] reconnecting…`));
  client.on("end", () => logger.warn(`Redis [${name}] connection closed`));
};

wire(pubClient, "pub");
wire(subClient, "sub");

export const connectRedis = async (): Promise<void> => {
  await Promise.all([pubClient.connect(), subClient.connect()]);
  logger.info("Redis pub/sub clients connected");
};