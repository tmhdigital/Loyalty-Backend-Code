import { NotificationType } from "../app/modules/notification/notification.model";
import { Subscription } from "../app/modules/subscription/subscription.model";
import { User } from "../app/modules/user/user.model";
import { SUBSCRIPTION_STATUS } from "../enums/user";
import { sendNotification } from "../helpers/notificationsHelper";
import { logger } from "../shared/logger";

export const expireSubscriptionsJob = async () => {
  try {
    logger.info("========== [CRON] START ==========");

    const now = new Date();

    // 🔍 Step 1: Find expired active subscriptions
    const expiredSubscriptions = await Subscription.find({
      status: "active",
      currentPeriodEnd: { $lt: now },
    })
      .select("_id user currentPeriodEnd currentPeriodStart package")
      .populate("package", "title");

    logger.info(`📉 Found ${expiredSubscriptions.length} expired subscriptions`);

    if (!expiredSubscriptions.length) {
      logger.info("[CRON] No subscriptions to expire");
      logger.info("========== [CRON] END ==========");
      return;
    }

    // 🔹 Bulk update Subscriptions — every stale row auto-expires on its own
    // end date, unchanged, regardless of whether the user has since bought a
    // newer plan (old plans are never touched at purchase time — see
    // resolveNewSubscriptionPeriod).
    const subscriptionBulkOps = expiredSubscriptions.map((sub) => ({
      updateOne: {
        filter: { _id: sub._id },
        update: { $set: { status: "expired" as const } },
      },
    }));

    if (subscriptionBulkOps.length) {
      await Subscription.bulkWrite(subscriptionBulkOps);
    }

    // A user can hold more than one "active" row at once — a new purchase
    // carries the old plan's remaining time forward but leaves the old row
    // itself alone to expire naturally. So only touch the User-level flags,
    // and only notify, when the row that just expired is actually the
    // user's current/latest plan; otherwise a superseded old row expiring
    // would wrongly mark an actively-subscribed user as inactive.
    const latestPerUser = await Subscription.aggregate([
      { $match: { user: { $in: expiredSubscriptions.map((sub) => sub.user) } } },
      { $sort: { currentPeriodStart: -1 } },
      { $group: { _id: "$user", latestSubId: { $first: "$_id" } } },
    ]);
    const latestSubIdByUser = new Map(
      latestPerUser.map((row) => [row._id.toString(), row.latestSubId.toString()])
    );

    const currentPlanExpirations = expiredSubscriptions.filter(
      (sub) => latestSubIdByUser.get(sub.user.toString()) === sub._id.toString()
    );

    // 🔹 Bulk update Users — only for users whose current plan just expired
    const userBulkOps = currentPlanExpirations.map((sub) => ({
      updateOne: {
        filter: { _id: sub.user },
        update: {
          $set: {
            subscription: SUBSCRIPTION_STATUS.INACTIVE,
            paymentStatus: "expired",
          },
        },
      },
    }));

    if (userBulkOps.length) {
      await User.bulkWrite(userBulkOps);
    }

    // 🔹 Send notifications — same scoping as the User-flag update above.
    // Sent per-subscription (not batched) since each user's package name differs.
    // Each send is isolated: these subscriptions are already flipped to
    // "expired" above, so tomorrow's cron won't retry them — one failed send
    // must not stop the rest of the batch from being notified.
    for (const sub of currentPlanExpirations) {
      const packageName = (sub.package as any)?.title || "Membership";
      try {
        await sendNotification({
          userIds: [sub.user],
          title: `Your Membership plan has been expired.`,
          body: `Your "${packageName}" Membership has expired. Please renew to continue enjoying our services.`,
          type: NotificationType.SYSTEM,
          channel: { socket: true, push: true },
        });
      } catch (error) {
        logger.error(`Failed to send expiry notification to user ${sub.user}`, error);
      }
    }

    logger.info("[CRON] Expired subscription notifications sent");
    logger.info("========== [CRON] END ==========");
  } catch (error) {
    logger.error("❌ [CRON] Subscription expire check failed", error);
  }
};  

