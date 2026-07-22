import { Types } from "mongoose";
import Referral from "./referral.model";
import { User } from "../user/user.model";
import PointTransaction from "../pointTransaction/pointTransaction.model";
import { Subscription } from "../subscription/subscription.model";
import { sendNotification } from "../../../helpers/notificationsHelper";
import { NotificationType } from "../notification/notification.model";
import { logger } from "../../../shared/logger";

/**
 * ============================================================================
 * Referral reward rules — SINGLE SOURCE OF TRUTH
 * ============================================================================
 *
 * The same 20% rule was previously copy-pasted into subscription.service.ts and
 * salesRep.service.ts with slightly different behaviour (one marked the referral
 * `completed`, the other didn't), and the Kuickpay flow had no copy at all —
 * which is why a Kuickpay purchase never rewarded the referrer and the referral
 * screen kept showing "+0.0".
 *
 * How the reward works end to end:
 *   1. B signs up with A's reference id  -> a Referral doc is created (completed: false)
 *   2. B pays for their FIRST subscription -> A earns 20% of B's package price AS POINTS
 *      and the Referral doc is marked completed: true
 *   3. When A later buys a package, their points are applied as a discount,
 *      capped at 80% of the package price (see MAX_POINTS_DISCOUNT_PERCENT)
 *
 * So a Rs 100 package with one completed referral costs A Rs 80; with enough
 * referrals the discount stops growing at 80% and A always pays at least 20%.
 */
export const REFERRAL_BONUS_PERCENT = 0.2;

/** A user can never discount more than this share of a package with points. */
export const MAX_POINTS_DISCOUNT_PERCENT = 0.8;

/** Points a referrer earns when their referred user pays `price`. */
export const calculateReferralPoints = (price: number): number =>
  Math.max(0, Math.round((price || 0) * REFERRAL_BONUS_PERCENT));

/**
 * Points that can actually be applied to a purchase, given the 80% cap.
 * Use this everywhere instead of re-deriving the cap per payment provider.
 */
export const calculateUsablePoints = (
  packagePrice: number,
  availablePoints: number
): number => {
  const maxDiscount = (packagePrice || 0) * MAX_POINTS_DISCOUNT_PERCENT;
  return Math.max(0, Math.min(availablePoints || 0, maxDiscount));
};

/**
 * Award the referrer when a referred user pays for a subscription.
 *
 * Safe to call from every payment flow (Stripe, Kuickpay, salesRep/manual) and
 * safe to call more than once for the same purchase: the Referral doc's
 * `completed` flag is flipped atomically, so only the first call ever pays out.
 *
 * @param subscribedUserId  the user who just paid (the REFERRED user)
 * @param subscriptionPrice price actually charged for that subscription
 * @param onlyFirstSubscription  keep the existing rule that the bonus is paid
 *        once, on the referred user's first subscription
 */
export const grantReferralBonusOnSubscription = async (params: {
  subscribedUserId: Types.ObjectId | string;
  subscriptionPrice: number;
  onlyFirstSubscription?: boolean;
}): Promise<{ granted: boolean; points?: number; reason?: string }> => {
  const {
    subscribedUserId,
    subscriptionPrice,
    onlyFirstSubscription = true,
  } = params;

  try {
    if (onlyFirstSubscription) {
      const subscriptionCount = await Subscription.countDocuments({
        user: subscribedUserId,
      });
      if (subscriptionCount > 1) {
        return { granted: false, reason: "not-first-subscription" };
      }
    }

    const referralPoints = calculateReferralPoints(subscriptionPrice);
    if (referralPoints <= 0) {
      return { granted: false, reason: "zero-points" };
    }

    // Atomically claim the referral. If another flow (e.g. the IPN racing the
    // app confirm call) already claimed it, this returns null and we stop.
    const referral = await Referral.findOneAndUpdate(
      { referredUser: subscribedUserId, completed: false },
      { $set: { completed: true } },
      { new: true }
    );

    if (!referral) {
      return { granted: false, reason: "no-pending-referral" };
    }

    const referrerId = referral.referrer;

    await User.findByIdAndUpdate(referrerId, {
      $inc: { points: referralPoints },
      $addToSet: { referralBonusGivenFor: subscribedUserId },
    });

    // This is what the referral screen reads to show "+20" next to the
    // referred user — without it the row stays at "+0.0".
    await PointTransaction.create({
      user: referrerId,
      type: "EARN",
      source: "REFERRAL",
      referral: referral._id,
      points: referralPoints,
      note: `Earned ${referralPoints} points from referral subscription (${subscribedUserId})`,
    });

    const [referredUser, referrerUser] = await Promise.all([
      User.findById(subscribedUserId).select("firstName lastName"),
      User.findById(referrerId).select("firstName lastName"),
    ]);

    const referredUserName = `${referredUser?.firstName || ""} ${
      referredUser?.lastName || ""
    }`.trim();
    const referrerUserName = `${referrerUser?.firstName || ""} ${
      referrerUser?.lastName || ""
    }`.trim();

    await sendNotification({
      userIds: [referrerId.toString()],
      title: "Referral Bonus Earned",
      body: `${referredUserName} subscribed using your referral code. You earned ${referralPoints} points!`,
      type: NotificationType.REFERRAL,
    });

    await sendNotification({
      userIds: [subscribedUserId.toString()],
      title: "Referral Applied",
      body: `You subscribed using the referral code of ${referrerUserName}.`,
      type: NotificationType.REFERRAL,
    });

    logger.info(
      `Referral bonus granted: referrer ${referrerId} earned ${referralPoints} points from ${subscribedUserId}`
    );

    return { granted: true, points: referralPoints };
  } catch (error) {
    // A referral payout must never break an already-successful payment.
    logger.error(
      `Failed to grant referral bonus for user ${subscribedUserId}`,
      error
    );
    return { granted: false, reason: "error" };
  }
};