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

  const data = await promotionQuery.modelQuery.populate(
    "merchantId",
    "website"
  );

  const pagination = await promotionQuery.getPaginationInfo();

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

  const data = await promotionQuery.modelQuery;

  const pagination = await promotionQuery.getPaginationInfo();

  return {
    promotions: data,
    pagination,
  };
};

/* ================= MERCHANT DETAILS ================= */
const getDetailsOfMerchant = async (merchantId: string, userId?: string) => {
  const merchant = await User.findById(merchantId)
    .select("firstName businessName location profile website")
    .lean();

  if (!merchant) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Merchant not found");
  }

  let userSegment = "all_customer";
  let digitalCard = null;

  if (userId) {
    const user = await User.findById(userId).lean();

    if (user?.status === "active") {
      userSegment = await getUserSegment(userId);
      digitalCard = await DigitalCard.findOne({ userId, merchantId }).lean();
    }
  }

  const promotions = await Promotion.find({ merchantId }).lean();

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
  const digitalCard = await DigitalCard.findOne({ userId, merchantId });

  const lifetimePoints = digitalCard?.lifeTimeEarnPoints ?? 0;

  const spendAgg = await Sell.aggregate([
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
  ]);

  const totalSpend = spendAgg[0]?.totalSpend || 0;

  const tiers = await Tier.find({ admin: merchantId }).sort({
    pointsThreshold: 1,
  });

  const userTier = getUserTier(tiers, lifetimePoints, totalSpend);

  return {
    lifetimePoints,
    availablePoints: digitalCard?.availablePoints ?? 0,
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

  const merchants = await User.find(
    { service: { $regex: new RegExp(categoryName, "i") } },
    { _id: 1 }
  );

  const merchantIds = merchants.map((m) => m._id);

  let promotions = await Promotion.find({
    merchantId: { $in: merchantIds },
  }).lean();

  const today = new Date();
  const dayMap = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const todayDay = dayMap[today.getDay()];

  let userSegment = "all_customer";

  if (userId) {
    const user = await User.findById(userId);
    if (!user || user.status !== "active") {
      throw new ApiError(StatusCodes.UNAUTHORIZED, "User not active");
    }

    userSegment = await getUserSegment(userId);
  }

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
  }).select("merchantId segment");

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

  // 7️⃣ Filter by date/day/userCard
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