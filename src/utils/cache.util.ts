// ============================================================================
// NEW FILE: src/utils/cache.util.ts
// ----------------------------------------------------------------------------
// A tiny Redis cache helper that REUSES the pubClient you already create in
// src/config/redisClients.ts. No new dependency, no new connection.
//
// Used by:
//   - auth middleware  (cache the per-request User.findById lookup)
//   - promotion / merchant-details reads (cache short-lived hot data)
//
// If REDIS_URL is not set, every function safely no-ops and the app behaves
// exactly as before — so functionality never breaks.
// ============================================================================

import { pubClient } from "../config/redisClients";
import { logger } from "../shared/logger";

const redisEnabled = () => Boolean(process.env.REDIS_URL) && pubClient.isReady;

export const cacheGet = async <T = unknown>(key: string): Promise<T | null> => {
  if (!redisEnabled()) return null;
  try {
    const raw = await pubClient.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (err: any) {
    logger.warn(`cacheGet failed for ${key}: ${err?.message}`);
    return null;
  }
};

export const cacheSet = async (
  key: string,
  value: unknown,
  ttlSeconds = 30
): Promise<void> => {
  if (!redisEnabled()) return;
  try {
    await pubClient.set(key, JSON.stringify(value), { EX: ttlSeconds });
  } catch (err: any) {
    logger.warn(`cacheSet failed for ${key}: ${err?.message}`);
  }
};

export const cacheDel = async (...keys: string[]): Promise<void> => {
  if (!redisEnabled() || keys.length === 0) return;
  try {
    await pubClient.del(keys);
  } catch (err: any) {
    logger.warn(`cacheDel failed: ${err?.message}`);
  }
};

// Invalidate everything matching a prefix, e.g. after a user updates a profile.
// Uses SCAN (non-blocking) instead of KEYS.
export const cacheDelByPrefix = async (prefix: string): Promise<void> => {
  if (!redisEnabled()) return;
  try {
    for await (const key of pubClient.scanIterator({
      MATCH: `${prefix}*`,
      COUNT: 100,
    })) {
      await pubClient.del(key);
    }
  } catch (err: any) {
    logger.warn(`cacheDelByPrefix failed for ${prefix}: ${err?.message}`);
  }
};