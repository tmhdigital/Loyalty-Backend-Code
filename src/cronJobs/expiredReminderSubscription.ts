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

    const subscriptions = await Subscription.find({ status: "active" })
      .select("user currentPeriodEnd");

    for (const sub of subscriptions) {
      

      const endDate = sub.currentPeriodEnd as Date;


      const remainingDays = Math.ceil(
        (endDate.getTime() - startOfToday.getTime()) /
          (1000 * 60 * 60 * 24)
      );

      if (!reminderDays.includes(remainingDays)) {
        continue;
      }

      const dayLabel = remainingDays === 1 ? "day" : "days";
      const title = `Your subscription expires in ${remainingDays} ${dayLabel}`;
      const body = `Hello! Your subscription will expire in ${remainingDays} ${dayLabel}.`;

      await sendNotification({
        userIds: [sub.user],
        title,
        body,
        type: NotificationType.MANUAL,
        channel: { socket: true, push: false },
      });
    }
  } catch (error) {
    logger.error("Something failed", error);
  }
};