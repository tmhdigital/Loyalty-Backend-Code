import { Types } from "mongoose";
import { Subscription } from "../app/modules/subscription/subscription.model";
import { calculateEndDate } from "./dateHelper";

// When a user buys a new plan while an older one is still running, the
// unused time on the old plan should carry forward instead of being wasted.
// The old subscription row is left untouched — it still auto-expires on its
// own currentPeriodEnd via the cron job, exactly as before.
export const resolveNewSubscriptionPeriod = async (
  userId: string | Types.ObjectId,
  duration: string
): Promise<{ currentPeriodStart: Date; currentPeriodEnd: Date }> => {
  const now = new Date();

  const currentSub = await Subscription.findOne({ user: userId, status: "active" })
    .select("currentPeriodEnd currentPeriodStart")
    .sort({ currentPeriodStart: -1 });

  const baseDate =
    currentSub && currentSub.currentPeriodEnd > now ? currentSub.currentPeriodEnd : now;

  return {
    currentPeriodStart: now,
    currentPeriodEnd: calculateEndDate(duration, baseDate),
  };
};
