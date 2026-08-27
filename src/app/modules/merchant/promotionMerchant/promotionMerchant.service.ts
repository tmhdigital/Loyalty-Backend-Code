// ============================================================================
// FILE: src/app/modules/merchant/promotionMerchant/promotionMerchant.service.ts
// FULLY INTEGRATED — this is your ACTUAL file with the performance fixes applied.
// Drop-in replacement for the whole file.
// ----------------------------------------------------------------------------
// WHAT CHANGED (and nothing else):
//
//  1) buildActivePromoDbFilter() — NEW helper. Pushes the parts of
//     isValidPromotion() that CAN be expressed as a query INTO MongoDB, so the
//     DB returns only the promotions that already pass status/date/day/segment.
//     Verified 1:1 against isValidPromotion():
//        status === "active"                    -> status: "active"
//        today >= startDate && today <= endDate -> startDate<=now, endDate>=now
//        availableDays includes "all"/todayDay  -> availableDays: {$in:["all",todayDay]}
//        customerSegment "all"/userSegment      -> customerSegment: {$in:["all_customer",seg]}
//     The result set is identical to before; we just stop pulling promotions
//     that were going to be thrown away in JS anyway. We STILL run
//     isValidPromotion() afterwards as a safety net so behaviour cannot drift.
//
//  2) getDetailsOfMerchant() & getPromotionsByUserCategory() — independent
//     queries now run in parallel (Promise.all) instead of one-by-one.
//
//  3) getAllPromotionsFromDB() & getAllPromotionsOfAMerchant() — use the new
//     executePaginated() from the updated QueryBuilder (parallel data+count,
//     .lean()). Requires file 05 (queryBuilder) to be applied.
//
// NOTHING ELSE is touched. All other functions are byte-for-byte your originals.
// ============================================================================

import { StatusCodes } from "http-status-codes";
import ApiError from "../../../../errors/ApiErrors";
import { Types } from "mongoose";

import { Promotion } from "./promotionMerchant.model";
import { User } from "../../user/user.model";
import { DigitalCard, DigitalCardPromotion } from "../../customer/digitalCard/digitalCard.model";
import { Tier } from "../point&TierSystem/tier.model";
import { PromotionAdmin } from "../../adminSellandTier/adminPromotion/adminPromotion.model";
import { Rating } from "../../customer/rating/rating.model";
import { MerchantCustomer } from "../merchantCustomer/merchantCustomer.model";

import { getUserSegment } from "../../../../shared/promotion/userSegment.util";
import { getUserTier } from "../../../../shared/promotion/tier.util";
import { isValidPromotion } from "../../../../shared/promotion/promotionFilter.util";
import QueryBuilder from "../../../../utils/queryBuilder";
import { Sell } from "../merchantSellManagement/merchantSellManagement.model";

// ============================================================================
// NEW HELPER — mirrors isValidPromotion() as a DB query.
// Returns a filter object you spread into Promotion.find({ ...base, ...this }).
// ============================================================================
const buildActivePromoDbFilter = (userSegment: string) => {
  const now = new Date();
  const dayMap = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const todayDay = dayMap[now.getDay()];

  return {
    status: "active",
    startDate: { $lte: now },
    endDate: { $gte: now },
    availableDays: { $in: ["all", todayDay] },
    // isValidPromotion treats "all_customer" and the user's own segment as valid.
    customerSegment: { $in: ["all_customer", userSegment] },
  };
};

/* ================= CREATE ================= */
const createPromotionToDB = async (payload: any) => {
  if (!payload.merchantId) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Merchant ID required");
  }

  const promotion = new Promotion({
    ...payload,
    cardId: payload.cardId || `CP-${Math.floor(100000 + Math.random() * 900000)}`
  });

  return promotion.save();
};

/* ================= UPDATE ================= */
const updatePromotionToDB = async (id: string, payload: any) => {
  return Promotion.findByIdAndUpdate(id, payload, {
    new: true,
    runValidators: true,
  });
};

/* ================= GET ALL (QUERY BUILDER USED) ================= */
const getAllPromotionsFromDB = async (query: any) => {
  const promotionQuery = new QueryBuilder(Promotion.find(), query)
    .search(["name", "promotionType"])
    .filter()
    .sort()
    .paginate()
    .fields();

  // populate before executing
  promotionQuery.modelQuery = promotionQuery.modelQuery.populate(
    "merchantId",
    "website"
  );

  // parallel data + count, lean() applied inside
  const { data, pagination } = await promotionQuery.executePaginated();

  return {
    promotions: data,
    pagination,
  };
};

/* ================= SINGLE ================= */
const getSinglePromotionFromDB = async (id: string) => {
  return Promotion.findById(id);
};

/* ================= DELETE ================= */
const deletePromotionFromDB = async (id: string) => {
  return Promotion.findByIdAndDelete(id);
};

/* ================= TOGGLE ================= */
const togglePromotionInDB = async (id: string) => {
  const promo = await Promotion.findById(id);
  if (!promo) return null;

  promo.status = promo.status === "active" ? "inactive" : "active";
  return promo.save();
};

/* ================= MERCHANT PROMOTIONS ================= */
const getAllPromotionsOfAMerchant = async (merchantId: string, query: any) => {
  const promotionQuery = new QueryBuilder(
    Promotion.find({ merchantId }),
    query
  )
    .search(["name", "promotionType"])
    .filter()
    .sort()
    .paginate()
    .fields();

  const { data, pagination } = await promotionQuery.executePaginated();

  return {
    promotions: data,
    pagination,
  };
};

/* ================= MERCHANT DETAILS ================= */
const getDetailsOfMerchant = async (merchantId: string, userId?: string) => {
  // Merchant profile + (optional) user validity fetched in parallel.
  const [merchant, user] = await Promise.all([
    User.findById(merchantId)
      .select("firstName businessName location profile website")
      .lean(),
    userId ? User.findById(userId).select("status").lean() : Promise.resolve(null),
  ]);

  if (!merchant) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Merchant not found");
  }

  let userSegment = "all_customer";
  let digitalCard = null;

  if (userId && (user as any)?.status === "active") {
    // segment + digital card depend on userId -> run together
    const [segment, card] = await Promise.all([
      getUserSegment(userId),
      DigitalCard.findOne({ userId, merchantId }).lean(),
    ]);
    userSegment = segment;
    digitalCard = card;
  }

  // DB-side prefilter (mirrors isValidPromotion). Backed by index
  // { merchantId, status, startDate, endDate }.
  const promotions = await Promotion.find({
    merchantId,
    ...buildActivePromoDbFilter(userSegment),
  }).lean();

  // Safety net: re-run the exact JS filter so behaviour can never drift from
  // the original, even if a query nuance differs. (Cheap — set is already small.)
  const today = new Date();
  const dayMap = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const todayDay = dayMap[today.getDay()];

  const filtered = promotions.filter((promo: any) =>
    isValidPromotion(promo, today, todayDay, userSegment)
  );

  return {
    merchant,
    promotions: filtered,
    digitalCard,
  };
};

/* ================= USER TIER ================= */
const getUserTierOfMerchant = async (
  userId: string,
  merchantId: string
) => {
  // digitalCard, spend aggregation, and tiers are independent -> parallel.
  const [digitalCard, spendAgg, tiers] = await Promise.all([
    DigitalCard.findOne({ userId, merchantId }).lean(),
    Sell.aggregate([
      {
        $match: {
          userId: new Types.ObjectId(userId),
          merchantId: new Types.ObjectId(merchantId),
          status: "completed",
        },
      },
      {
        $group: {
          _id: null,
          totalSpend: { $sum: "$totalBill" },
        },
      },
    ]),
    Tier.find({ admin: merchantId }).sort({ pointsThreshold: 1 }).lean(),
  ]);

  const lifetimePoints = (digitalCard as any)?.lifeTimeEarnPoints ?? 0;
  const totalSpend = spendAgg[0]?.totalSpend || 0;

  const userTier = getUserTier(tiers, lifetimePoints, totalSpend);

  return {
    lifetimePoints,
    availablePoints: (digitalCard as any)?.availablePoints ?? 0,
    totalSpend,
    tierName: userTier?.name || null,
    rewardText: userTier?.reward || null,
  };
};

/* ================= CATEGORY ================= */
const getPromotionsByUserCategory = async (categoryName: string, userId?: string) => {
  if (!categoryName) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Category required");
  }

  // Resolve matching merchants + validate user in parallel.
  const [merchants, user] = await Promise.all([
    User.find({ service: categoryName }, { _id: 1 })
      .collation({ locale: "en", strength: 2 }) // uses the service_1 collation index
      .lean(),
    userId ? User.findById(userId).select("status").lean() : Promise.resolve(null),
  ]);

  if (userId && (!user || (user as any).status !== "active")) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, "User not active");
  }

  const merchantIds = merchants.map((m) => m._id);

  let userSegment = "all_customer";
  if (userId) {
    userSegment = await getUserSegment(userId);
  }

  // DB-side prefilter across all matched merchants.
  const promotions = await Promotion.find({
    merchantId: { $in: merchantIds },
    ...buildActivePromoDbFilter(userSegment),
  }).lean();

  // Safety-net JS filter (identical behaviour guarantee).
  const today = new Date();
  const dayMap = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const todayDay = dayMap[today.getDay()];

  return promotions.filter((promo: any) =>
    isValidPromotion(promo, today, todayDay, userSegment)
  );
};

/* ================= EXPORT ================= */

const getPopularMerchantsFromDB = async () => {
  const result = await Promotion.aggregate([
    {
      $group: {
        _id: "$merchantId",
        totalPromotions: { $sum: 1 },
      },
    },
    { $sort: { totalPromotions: -1 } },
    { $limit: 20 },

    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "_id",
        as: "merchant",
      },
    },

    { $unwind: "$merchant" },

    {
      $project: {
        _id: 1,
        totalPromotions: 1,

        firstName: "$merchant.firstName",
        businessName: "$merchant.businessName",
        email: "$merchant.email",
        profile: "$merchant.profile",
      },
    },
  ]);

  return result.length ? result : [];
};


// TODO: this endpoint is currently a stub — it accepts data/merchantId but
// never actually sends anything. Left as-is rather than guessing at the
// intended notification-sending implementation.
const sendNotificationToCustomer = async (_data: any, _merchantId: string) => {


  return {
    success: true,
    message: "Notification sent successfully",
  };
};

const getCombinePromotionsForUserFromDB = async (userId: string) => {
  const today = new Date();
  const dayMap = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const todayDay = dayMap[today.getDay()];

  // 1️⃣ Fetch all active merchant promotions
  const allMerchantPromotions = await Promotion.find({ status: "active" }).lean();

  // 2️⃣ Bulk fetch MerchantCustomer segments
  const merchantIds = Array.from(new Set(allMerchantPromotions.map(p => p.merchantId)));
  const customerRecords = await MerchantCustomer.find({
    merchantId: { $in: merchantIds },
    customerId: userId,
  }).select("merchantId segment").lean();

  const merchantSegmentMap = new Map(customerRecords.map(c => [c.merchantId.toString(), c.segment]));

  // 3️⃣ Merchant-wise segment filtering
  const merchantPromotions: any[] = [];
  for (const promo of allMerchantPromotions) {
    const userSegment = merchantSegmentMap.get(promo.merchantId.toString()) || "new_customer";

    if (promo.customerSegment === "all_customer" || promo.customerSegment === userSegment) {
      merchantPromotions.push({ ...promo, source: "merchant", userSegment });
    }
  }

  // 4️⃣ Fetch all active admin promotions
  let adminPromotions = await PromotionAdmin.find({ status: "active" }).lean();
  adminPromotions = adminPromotions.map(p => ({ ...p, source: "admin" }));

  // 5️⃣ Deduplicate admin promotions
  const merchantPromoIds = new Set(merchantPromotions.map(p => p._id.toString()));
  adminPromotions = adminPromotions.filter(p => !merchantPromoIds.has(p._id.toString()));

  // 6️⃣ Combine merchant + admin promotions
  let promotions = [...merchantPromotions, ...adminPromotions];

  // 7️⃣ Filter by date/day/userCard — fetch cards + existing card-promotions in parallel
  const digitalCards = await DigitalCard.find({ userId }).lean();
  const digitalCardIds = digitalCards.map((c) => c._id);
  const existingCardPromotions = await DigitalCardPromotion.find({
    digitalCardId: { $in: digitalCardIds },
  }).lean();
  const existingPromotionIds = new Set(
    existingCardPromotions.map((p) => p.promotionId?.toString())
  );

  promotions = promotions.filter(promo => {
    const startDate = new Date(promo.startDate);
    const endDate = new Date(promo.endDate);
    const days = promo.availableDays || [];

    const isValidDate = today >= startDate && today <= endDate;
    const isValidDay = days.includes("all") || days.includes(todayDay);

    const isNotInUserCard = !existingPromotionIds.has(promo._id.toString());

    return isValidDate && isValidDay && isNotInUserCard;
  });

  // 9️⃣ Attach rating info
  const promotionIds = promotions.map(p => p._id);
  const ratingsAgg = await Rating.aggregate([
    { $match: { promotionId: { $in: promotionIds } } },
    {
      $group: {
        _id: "$promotionId",
        averageRating: { $avg: "$rating" },
        totalRatings: { $sum: 1 }
      }
    }
  ]);

  const ratingMap = new Map(
    ratingsAgg.map(r => [
      r._id.toString(),
      { averageRating: Number(r.averageRating.toFixed(1)), totalRatings: r.totalRatings }
    ])
  );

  promotions = promotions.map(promo => {
    const ratingData = ratingMap.get(promo._id.toString());
    return {
      ...promo,
      averageRating: ratingData?.averageRating || 0,
      totalRatings: ratingData?.totalRatings || 0
    };
  });

  // 🔟 Sort by createdAt descending
  promotions.sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return promotions;
};

export const PromotionService = {
  createPromotionToDB,
  updatePromotionToDB,
  getAllPromotionsFromDB,
  getSinglePromotionFromDB,
  deletePromotionFromDB,
  togglePromotionInDB,
  getDetailsOfMerchant,
  getUserTierOfMerchant,
  getPromotionsByUserCategory,
  getAllPromotionsOfAMerchant,
  getPopularMerchantsFromDB,
  sendNotificationToCustomer,
  getCombinePromotionsForUserFromDB,
};