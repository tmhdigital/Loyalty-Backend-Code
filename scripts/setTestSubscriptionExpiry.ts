/**
 * LOCAL TESTING ONLY — do not run against production data.
 *
 * Sets an existing subscription's currentPeriodStart/currentPeriodEnd to a
 * few minutes from now, so you can watch ENABLE_FAST_TEST_CRON=true fire
 * reminder/expiry notifications without waiting for a real month/year
 * duration to pass.
 *
 * Usage:
 *   npx ts-node scripts/setTestSubscriptionExpiry.ts <email> <minutesFromNow>
 *
 * Examples:
 *   # Test actual expiry in ~2 minutes
 *   npx ts-node scripts/setTestSubscriptionExpiry.ts test@example.com 2
 *
 *   # Test the "expires in 1 day" reminder immediately (any value < 1440
 *   # rounds up to "1 day" remaining, since the reminder job checks whole
 *   # days — see expiredReminderSubscription.ts)
 *   npx ts-node scripts/setTestSubscriptionExpiry.ts test@example.com 5
 *
 * The user must already have at least one subscription (buy any plan for
 * them first through the normal app flow) — this script only edits dates on
 * their most recent one, it doesn't create a new subscription.
 */
import mongoose from "mongoose";
import config from "../src/config";
import { Subscription } from "../src/app/modules/subscription/subscription.model";
import { User } from "../src/app/modules/user/user.model";

async function main() {
  const [, , email, minutesArg] = process.argv;
  const minutes = Number(minutesArg);

  if (!email || !minutesArg || Number.isNaN(minutes)) {
    console.error(
      "Usage: npx ts-node scripts/setTestSubscriptionExpiry.ts <email> <minutesFromNow>"
    );
    process.exit(1);
  }

  if (!config.database_url) {
    throw new Error("DATABASE_URL is not set in .env");
  }

  await mongoose.connect(config.database_url);

  try {
    const user = await User.findOne({ email });
    if (!user) throw new Error(`No user found with email ${email}`);

    const subscription = await Subscription.findOne({ user: user._id }).sort({
      currentPeriodStart: -1,
    });
    if (!subscription) {
      throw new Error(
        `No subscription found for ${email} — buy any plan for this user first, then re-run this script.`
      );
    }

    const now = new Date();
    subscription.status = "active";
    subscription.currentPeriodStart = now;
    subscription.currentPeriodEnd = new Date(now.getTime() + minutes * 60 * 1000);
    await subscription.save();

    console.log(
      `✅ Subscription ${subscription._id} (${email}) now expires in ${minutes} minute(s)\n` +
        `   currentPeriodEnd = ${subscription.currentPeriodEnd.toISOString()}`
    );
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
