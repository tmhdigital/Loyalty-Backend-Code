import cron from "node-cron";
import { logger } from "../shared/logger";

import { updateMerchantVipCustomersJob } from "./vipCustomer";
import { downgradeInactiveTiers } from "./updateMerchantVipCustomersJob";
import { expireSubscriptionsJob } from "./expiredSubscription";
import { expireReminderSubscriptionsJob } from "./expiredReminderSubscription";

// ✅ Store all cron tasks here
export const cronTasks: cron.ScheduledTask[] = [];

export const startCronJobs = () => {
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

    logger.info("[CRON] All cron jobs registered successfully");
  } catch (error) {
    logger.error("[CRON] Failed to initialize cron jobs", error);
  }
};

// ✅ Graceful stop function
export const stopCronJobs = () => {
  logger.info("[CRON] Stopping all cron jobs...");

  cronTasks.forEach((task) => {
    task.stop();
  });

  logger.info("[CRON] All cron jobs stopped successfully");
};