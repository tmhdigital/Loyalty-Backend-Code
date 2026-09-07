import { NotificationType } from "../app/modules/notification/notification.model";
import { Subscription } from "../app/modules/subscription/subscription.model";
import { sendNotification } from "../helpers/notificationsHelper";
import { logger } from "../shared/logger";

export const expireReminderSubscriptionsJob = async () => {
  try {
    const today = new Date();


    const startOfToday = new Date(today);
    startOfToday.setUTCHours(0, 0, 0, 0);

    const reminderDays = [30, 15, 7, 1];

    // A user can end up with more than one "active" subscription row (e.g. they
    // bought a 1-month plan, then bought a 1-year plan 5 days later — the old
    // row isn't touched and stays "active" until its own end date). Only the
    // most recently started subscription is the one the user actually cares
    // about, so sort newest-first and keep just one row per user.
    const subscriptions = await Subscription.find({ status: "active" })
      .select("user currentPeriodEnd currentPeriodStart package")
      .populate("package", "title")
      .sort({ currentPeriodStart: -1 });

    const seenUsers = new Set<string>();
    const currentSubscriptions = subscriptions.filter((sub) => {
      const userId = sub.user.toString();
      if (seenUsers.has(userId)) return false;
      seenUsers.add(userId);
      return true;
    });

    for (const sub of currentSubscriptions) {

      const endDate = sub.currentPeriodEnd as Date;


      const remainingDays = Math.ceil(
        (endDate.getTime() - startOfToday.getTime()) /
          (1000 * 60 * 60 * 24)
      );

      if (!reminderDays.includes(remainingDays)) {
        continue;
      }

      const dayLabel = remainingDays === 1 ? "day" : "days";
      const packageName = (sub.package as any)?.title || "Membership";
      const title = `Your "${packageName}" Membership expires in ${remainingDays} ${dayLabel}`;
      const body = `Hello! Your "${packageName}" Membership will expire in ${remainingDays} ${dayLabel}.`;

      // Isolate each send so one failure doesn't stop reminders for the rest
      // of today's batch.
      try {
        await sendNotification({
          userIds: [sub.user],
          title,
          body,
          type: NotificationType.MANUAL,
          channel: { socket: true, push: false },
        });
      } catch (error) {
        logger.error(`Failed to send reminder notification to user ${sub.user}`, error);
      }
    }
  } catch (error) {
    logger.error("Something failed", error);
  }
};