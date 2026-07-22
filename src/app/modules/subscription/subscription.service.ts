import { JwtPayload } from "jsonwebtoken";
import { Package } from "../package/package.model";
import { ISubscription } from "./subscription.interface";
import { Subscription } from "./subscription.model";
import stripe from "../../../config/stripe";
import { User } from "../user/user.model";
import Stripe from "stripe";
import { Types } from "mongoose";
import { grantReferralBonusOnSubscription } from "../referral/referral.helper";
import PointTransaction from "../pointTransaction/pointTransaction.model";
import { sendNotification } from "../../../helpers/notificationsHelper";
import { NotificationType } from "../notification/notification.model";
import { calculateEndDate } from "../../../helpers/dateHelper";
import { SUBSCRIPTION_STATUS } from "../../../enums/user";


// =========================
// createSubscriptionSession
// =========================

const calculateISODateString = (date: Date) => {
  return date.toISOString(); // "2026-04-06T05:31:35.697Z" ফরম্যাটে
};
const createSubscriptionSession = async (userId: string, packageId: string) => {


  const pkg = await Package.findById(packageId);
  if (!pkg) throw new Error("Package not found");


  const user = await User.findById(userId);
  if (!user) throw new Error("User not found");


  // Free trial
  if (pkg.isFreeTrial) {
    const hasUsedFreePlan = await Subscription.exists({ user: userId, package: packageId });
    if (hasUsedFreePlan) throw new Error("You have already used the free plan");

    const subscription = await Subscription.create({
      user: userId,
      package: packageId,
      price: 0,
      subscriptionId: "FREE_PLAN_" + Date.now(),
      currentPeriodStart: calculateISODateString(new Date()),
      currentPeriodEnd: calculateISODateString(calculateEndDate(pkg.duration)),
      status: "active",
      source: "manual",
      remaining: 1,
      customerId: null,
    });



    await User.findByIdAndUpdate(userId, { subscription: SUBSCRIPTION_STATUS.ACTIVE,paymentStatus: "paid", });

    return { sessionId: null, url: null, subscription };
  }

  // Paid plan

  let userPoints = user.points || 0;
  let finalPrice = pkg.price;
  const maxDiscount = pkg.price * 0.8;
  const usablePoints = Math.min(userPoints, maxDiscount);

  if (usablePoints > 0) {
    finalPrice -= usablePoints;

  }

  // Stripe Price logic
  pkg.priceIdWithPoints = pkg.priceIdWithPoints || {};
  let stripePriceId: string;

  if (usablePoints > 0) {
    if (pkg.priceIdWithPoints[usablePoints]) {
      stripePriceId = pkg.priceIdWithPoints[usablePoints];
    } else {
      const stripePrice = await stripe.prices.create({
        product: pkg.productId,
        unit_amount: Math.round(finalPrice * 100),
        currency: "usd",
        recurring: {
          interval: pkg.paymentType?.toLowerCase() === "monthly" ? "month" : "year",
        },
      });
      stripePriceId = stripePrice.id;
      pkg.priceIdWithPoints[usablePoints] = stripePriceId;
      await Package.findByIdAndUpdate(pkg._id, { priceIdWithPoints: pkg.priceIdWithPoints });
    }
  } else {
    stripePriceId = pkg.priceId!;
  }

  // ✅ Checkout session
  const session: Stripe.Checkout.Session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    mode: "subscription",
    customer_email: user.email,
    line_items: [{ price: stripePriceId, quantity: 1 }],
    success_url:  process.env.SUCCESS_URL as string,
    cancel_url: process.env.FAILED_URL as string,
    client_reference_id: userId.toString(),
    metadata: {
      packageId: pkg._id.toString(),
      pointsUsed: usablePoints.toString(),
    },
  });


  return { sessionId: session.id, url: session.url };
};







// Called from webhook to save subscription after payment success


const activateSubscriptionInDB = async (
  userId: string,
  packageId: string,
  stripeSubscription: any
): Promise<ISubscription> => {


  // 🔍 Prevent duplicate subscription
  const existingSub = await Subscription.findOne({
    subscriptionId: stripeSubscription.id
  });


  if (existingSub) {


    await User.findByIdAndUpdate(userId, {
      subscription: "active",
      paymentStatus: "paid"
    });


    return existingSub;
  }

  // 📦 Prepare subscription data
  const subscriptionData: Partial<ISubscription> = {
    user: new Types.ObjectId(userId),
    package: new Types.ObjectId(packageId),
    price: stripeSubscription.plan?.amount / 100 || 0,
    customerId: stripeSubscription.customer,
    subscriptionId: stripeSubscription.id,
    remaining: 0,
     currentPeriodStart: new Date(
    stripeSubscription.current_period_start * 1000
    ),

    currentPeriodEnd: new Date(
      stripeSubscription.current_period_end * 1000
    ),
    trxId: stripeSubscription.latest_invoice || "N/A",
    status: stripeSubscription.status === "active" ? "active" : "expired",
  };



  // 💾 Save subscription
  const subscription = await Subscription.create(subscriptionData);


  // 👤 Update user profile
  await User.findByIdAndUpdate(userId, {
    subscription: "active",
    paymentStatus: "paid"
  });



  // ======================================================
  // 🔥 Referral Bonus (20% to referrer)
  // ======================================================
  // Moved into referral.helper.ts so Stripe, Kuickpay and salesRep all behave
  // identically. The old inline copy here never set Referral.completed = true,
  // which is why referral rows stayed "completed: false" in the database even
  // after a bonus was paid.
  await grantReferralBonusOnSubscription({
    subscribedUserId: userId,
    subscriptionPrice: subscriptionData.price || 0,
  });

  return subscription;
};




const cancelSubscription = async (user: JwtPayload) => {

    // 1️⃣ DB থেকে active subscription খুঁজে বের করো
    const subscription = await Subscription.findOne({ user: user._id, status: "active" });
    if (!subscription) {
        throw new Error("Active subscription not found");
    }

    await stripe.subscriptions.update(subscription.subscriptionId, {
        cancel_at_period_end: true
    });


    subscription.status = "cancel"; 
    await subscription.save();


    await User.findByIdAndUpdate(user.id, { isSubscribed: false });

    return {
        subscriptionId: subscription.subscriptionId,
        currentPeriodEnd: subscription.currentPeriodEnd
    };
};


const subscriptionDetailsFromDB = async (user: JwtPayload): Promise<{ subscription: ISubscription | object }> => {

    const subscription = await Subscription.findOne({ user: user.id }).populate("package", "title credit").lean();
    if (!subscription) {
        return { subscription: {} };
    }

    // ✅ Only check Stripe for online (Stripe) subscriptions
    // salesRep / free / manual subscriptions don't have a real Stripe ID
    if (subscription.source === "online") {
      try {
        const subscriptionFromStripe = await stripe.subscriptions.retrieve(subscription.subscriptionId);
        if (subscriptionFromStripe?.status !== "active") {
          await Promise.all([
            User.findByIdAndUpdate(user.id, { isSubscribed: false }, { new: true }),
            Subscription.findOneAndUpdate({ user: user.id }, { status: "expired" }, { new: true }),
          ]);
        }
      } catch {
        // Stripe unavailable — keep current DB status
      }
    }

    return { subscription };
};

const companySubscriptionDetailsFromDB = async (
  userId: string
): Promise<{ subscriptions: ISubscription[] }> => {
  const subscriptions = await Subscription.find({ user: userId })
    .populate("package", "title credit")
    .sort({ createdAt: -1 })
    .lean();

  if (!subscriptions || subscriptions.length === 0) {
    return { subscriptions: [] };
  }

  // ✅ Only check Stripe for online subscriptions
  // salesRep / free / manual subscriptions don't have real Stripe IDs
  // — calling stripe.retrieve() on them returns error → was wrongly marking them expired ❌
  await Promise.all(subscriptions.map(async (sub) => {
    if (sub.source !== "online") return; // skip non-Stripe subscriptions

    try {
      const subscriptionFromStripe = await stripe.subscriptions.retrieve(sub.subscriptionId);
      if (!subscriptionFromStripe || subscriptionFromStripe.status !== "active") {
        await Promise.all([
          User.findByIdAndUpdate(userId, { isSubscribed: false }, { new: true }),
          Subscription.findByIdAndUpdate(sub._id, { status: "expired" }, { new: true }),
        ]);
      }
    } catch {
      // Stripe unavailable — keep current DB status
    }
  }));

  return { subscriptions };
}



const subscriptionsFromDB = async (
  query: Record<string, unknown>
) => {
  const { search, limit, page, paymentType } = query;

  const pages = parseInt(page as string) || 1;
  const size = parseInt(limit as string) || 10;
  const skip = (pages - 1) * size;

  const matchStage: any = {};

  // =========================
  // Payment type filter (FIXED ❌ no subquery)
  // =========================
  if (paymentType) {
    matchStage["package.paymentType"] = paymentType;
  }

  // =========================
  // Search filter
  // =========================
  if (search) {
    matchStage.$or = [
      { "package.title": { $regex: search, $options: "i" } },
      { "package.paymentType": { $regex: search, $options: "i" } },
    ];
  }

  // =========================
  // MAIN AGGREGATION (OPTIMIZED)
  // =========================
  const result = await Subscription.aggregate([
    {
      $lookup: {
        from: "packages",
        localField: "package",
        foreignField: "_id",
        as: "package",
      },
    },
    { $unwind: "$package" },

    {
      $lookup: {
        from: "users",
        localField: "user",
        foreignField: "_id",
        as: "user",
      },
    },
    { $unwind: "$user" },

    {
      $match: matchStage,
    },

    {
      $project: {
        user: {
          email: 1,
          name: 1,
          linkedIn: 1,
          contact: 1,
          company: 1,
          website: 1,
        },
        package: {
          title: 1,
          paymentType: 1,
          credit: 1,
          description: 1,
        },
        price: 1,
        trxId: 1,
        currentPeriodStart: 1,
        currentPeriodEnd: 1,
        status: 1,
      },
    },

    { $skip: skip },
    { $limit: size },
  ]);

  // =========================
  // COUNT (OPTIMIZED)
  // =========================
  const countResult = await Subscription.aggregate([
    {
      $lookup: {
        from: "packages",
        localField: "package",
        foreignField: "_id",
        as: "package",
      },
    },
    { $unwind: "$package" },

    {
      $match: matchStage,
    },

    {
      $count: "total",
    },
  ]);

  const count = countResult[0]?.total || 0;

  // =========================
  // RESPONSE
  // =========================
  return {
    data: result,
    meta: {
      page: pages,
      total: count,
    },
  };
};

export const SubscriptionService = {
    createSubscriptionSession,
    activateSubscriptionInDB,
    subscriptionDetailsFromDB,
    subscriptionsFromDB,
    companySubscriptionDetailsFromDB,
    cancelSubscription
}








// batter thinkg but any time need then apply this logic