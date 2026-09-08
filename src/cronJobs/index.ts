// ============================================================================
// FILE: src/cronJobs/index.ts
// FIX: In PM2 cluster mode (2 workers), startCronJobs() runs in BOTH workers,
// so every cron job fires TWICE per schedule. That can double-process
// subscriptions, tiers, VIP updates — real data bugs.
//
// FIX: Only start cron on ONE worker. PM2 sets NODE_APP_INSTANCE to "0","1",...
// per worker, so we run cron only on instance "0".
// ----------------------------------------------------------------------------
// HOW TO APPLY: wrap the body of startCronJobs() with the guard below.
// Everything else in the file stays the same. Shown here is just the shape —
// keep all your existing cron.schedule(...) calls inside the guard.
// ============================================================================

import cron from "node-cron";
import { logger } from "../shared/logger";

import { updateMerchantVipCustomersJob } from "./vipCustomer";
import { downgradeInactiveTiers } from "./updateMerchantVipCustomersJob";
import { expireSubscriptionsJob } from "./expiredSubscription";
import { expireReminderSubscriptionsJob } from "./expiredReminderSubscription";

export const cronTasks: cron.ScheduledTask[] = [];

export const startCronJobs = () => {
  // ── GUARD: only the primary worker runs cron ──────────────────────────
  // NODE_APP_INSTANCE is "0" for the first PM2 cluster worker. In fork mode or
  // when the var is unset (local `npm run dev`), it's undefined -> we still run
  // (single process, so no duplication risk).
  const instance = process.env.NODE_APP_INSTANCE;
  if (instance !== undefined && instance !== "0") {
    logger.info(`[CRON] Skipping cron on worker instance ${instance}`);
    return;
  }
  logger.info("[CRON] Starting cron jobs on primary worker");

  try {
    // 🔹 VIP Customer Update
    const vipTask = cron.schedule("20 8 * * *", async () => {
      try {
        logger.info("[CRON] VIP customer update started");
        await updateMerchantVipCustomersJob();
        logger.info("[CRON] VIP customer update finished");
      } catch (error) {
        logger.error("[CRON] VIP customer update failed", error);
      }
    });
    cronTasks.push(vipTask);

    // 🔹 Tier Downgrade
    const tierTask = cron.schedule("26 8 * * *", async () => {
      try {
        logger.info("[CRON] Tier downgrade job started");
        await downgradeInactiveTiers();
        logger.info("[CRON] Tier downgrade job finished");
      } catch (error) {
        logger.error("[CRON] Tier downgrade job failed", error);
      }
    });
    cronTasks.push(tierTask);

    // 🔹 Subscription Expire Check
    const expireTask = cron.schedule("28 8 * * *", async () => {
      try {
        logger.info("[CRON] Subscription expire job started");
        await expireSubscriptionsJob();
        logger.info("[CRON] Subscription expire job finished");
      } catch (error) {
        logger.error("[CRON] Subscription expire job failed", error);
      }
    });
    cronTasks.push(expireTask);

    // 🔹 Reminder Subscription Expire
    const reminderTask = cron.schedule("30 8 * * *", async () => {
      try {
        logger.info("[CRON] Subscription reminder job started");
        await expireReminderSubscriptionsJob();
        logger.info("[CRON] Subscription reminder job finished");
      } catch (error) {
        logger.error("[CRON] Subscription reminder job failed", error);
      }
    });
    cronTasks.push(reminderTask);
    // ⚠️ Keep whatever other cron.schedule(...) calls you already had here,
    //    inside this same guarded block. (Times above are placeholders that
    //    match your original file — do not change them unless you intend to.)
  } catch (error) {
    logger.error("[CRON] Failed to start cron jobs", error);
  }
};

export const stopCronJobs = () => {
  cronTasks.forEach((task) => task.stop());
  cronTasks.length = 0;
  logger.info("[CRON] All cron jobs stopped");
};