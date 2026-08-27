import { Types } from "mongoose";
import { Sell } from "./merchantSellManagement.model";
import { RequestApprovalOptions } from "./merchantSellManagement.interface";

import { PromotionService } from "../promotionMerchant/promotionMerchant.service";
import { DigitalCardService } from "../../customer/digitalCard/digitalCard.service";
import { TierService } from "../point&TierSystem/tier.service";
import { RatingService } from "../../customer/rating/rating.service";
import QueryBuilder from "../../../../utils/queryBuilder"; 

import { User } from "../../user/user.model";


import mongoose from "mongoose";
import { DigitalCard, DigitalCardPromotion } from "../../customer/digitalCard/digitalCard.model";
import ApiError from "../../../../errors/ApiErrors";
import { StatusCodes } from "http-status-codes";

const checkout = async (
  merchantId: string,
  digitalCardCode: string,
  totalBill: number,
  promotionIds: string[] = [],
  pointRedeemed: number = 0
) => {
  const POINT_REDEEM_RATE = 10;
  const POINT_EARN_RATE = 10;

  const session = await mongoose.startSession();
  let sell: any;

  try {
    session.startTransaction();

    // ===============================
    // 🔍 Find Digital Card
    // ===============================
    const digitalCard =
      await DigitalCardService.findByMerchantAndCardCode(
        merchantId,
        digitalCardCode,
        session
      );

    if (!digitalCard) throw new Error("Digital Card not found");

    if (digitalCard.merchantId?.toString() !== merchantId) {
      throw new Error("Digital card does not belong to this merchant");
    }

    // ===============================
    // 🔐 Validate User
    // ===============================
    const cardUser = await User.findById(digitalCard.userId).session(session);

    if (!cardUser) throw new Error("User not found");

    if (cardUser.status !== "active") {
      throw new Error("User account is inactive. Checkout not allowed.");
    }

    if (cardUser.subscription !== "active") {
      throw new Error("User subscription is not active.");
    }

    // ===============================
    // 🔍 Validate Points
    // ===============================
    if (pointRedeemed > digitalCard.availablePoints) {
      throw new Error("Not enough available points");
    }

    // ===============================
    // 🔖 Promotions (NEW WAY FIXED)
    // ===============================
    let totalDiscount = 0;
    let totalGrossValue = 0;

    for (const promoId of promotionIds) {
      const promoInCard = await DigitalCardPromotion.findOne({
        digitalCardId: digitalCard._id,
        promotionId: promoId,
      }).session(session);

      if (!promoInCard) {
        throw new Error(`Promotion ${promoId} not found in card`);
      }

      const promotion = await PromotionService.getSinglePromotionFromDB(promoId);

      if (!promotion) {
        throw new Error(`Promotion ${promoId} not found in DB`);
      }

      if (promotion.merchantId?.toString() !== merchantId) {
        throw new Error(
          `Promotion ${promoId} does not belong to this merchant`
        );
      }

      if (promotion.status && promotion.status !== "active") {
        throw new Error(`Promotion ${promoId} is not active`);
      }

      if (
        promotion.expiryDate &&
        new Date(promotion.expiryDate) < new Date()
      ) {
        throw new Error(`Promotion ${promoId} has expired`);
      }

      const grossValue = promotion.grossValue || 0;
      const discountPercentage = promotion.discountPercentage || 0;

      totalGrossValue += grossValue;
      totalDiscount += (grossValue * discountPercentage) / 100;
    }

    // ===============================
    // 💰 Bill Calculation
    // ===============================
    const discountedBills = totalBill - totalDiscount;
    const pointDiscount = pointRedeemed * POINT_REDEEM_RATE;
    const finalBill = discountedBills - pointDiscount;

    if (finalBill < 0) {
      throw new Error("Final bill cannot be negative");
    }

    // ===============================
    // ⭐ Tier
    // ===============================
    const userTier = await TierService.getBestTierForPoints(
      merchantId,
      digitalCard.lifeTimeEarnPoints || 0
    );

    const accumulationPercentage = userTier?.accumulationRule || 0;

    const netBillForPoint = Math.max(totalBill - totalGrossValue, 0);
    const eligibleAmount =
      (netBillForPoint * accumulationPercentage) / 100;

    let pointsEarned = eligibleAmount / POINT_EARN_RATE;

    // ===============================
    // 🧾 Create Sell
    // ===============================
    sell = await Sell.create(
      [
        {
          merchantId,
          userId: digitalCard.userId,
          digitalCardId: digitalCard._id,
          digitalCardCode,

          promotionIds,

          totalBill,
          totalGrossValue,
          totalDiscount,

          discountedBill: finalBill,
          pointRedeemed,
          pointDiscount,

          netBillForPoint,
          accumulationPercentage,
          eligibleAmount,
          pointsEarned,

          status: pointRedeemed > 0 ? "pending" : "completed",
        },
      ],
      { session }
    );

    sell = sell[0];

    // ===============================
    // 🔔 Update Card (FIXED)
    // ===============================
    if (pointRedeemed === 0) {
      digitalCard.availablePoints =
        digitalCard.availablePoints - pointRedeemed + pointsEarned;

      digitalCard.lifeTimeEarnPoints =
        (digitalCard.lifeTimeEarnPoints || 0) + pointsEarned;

      for (const promoId of promotionIds) {
        await DigitalCardPromotion.updateOne(
          {
            digitalCardId: digitalCard._id,
            promotionId: promoId,
          },
          {
            $set: {
              status: "used",
              usedAt: new Date(),
            },
          },
          { session }
        );
      }

      await digitalCard.save({ session });
    }

    // ===============================
    // ✅ COMMIT
    // ===============================
    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }

  // ===============================
  // 📡 SOCKET
  // ===============================
if (sell?.status === "pending") {
  const io = (global as any).io;

  const socketPayload = {
    sellId: sell._id,
    merchantId,
    digitalCardCode,
    pointRedeemed,
    message: "Merchant requested checkout approval",
  };

  if (io) {
    io.emit(`getApplyRequest::${sell.userId}`, socketPayload);

  } 
}

  return sell;
};







// -----------------------------










const requestApproval = async ({
  merchantId,
  digitalCardCode,
  promotionId = null,
  totalBill = 0,
  pointRedeemed = 0,
}: RequestApprovalOptions) => {
  const POINT_EARN_RATE = 10;
  const POINT_REDEEM_RATE = 10;

  const activeTierExists =
    await TierService.hasActiveTierForMerchant(merchantId);
  if (!activeTierExists) {
    throw new Error(
      "Merchant has no active tier. Please create a tier before processing sales."
    );
  }

  let digitalCard: any = null;

  let appliedPromotionIds: string[] = [];

  if (promotionId) {
    appliedPromotionIds = Array.isArray(promotionId)
      ? promotionId
      : [promotionId];
  }


  // ===============================
  // 🔍 FIND CARD
  // ===============================
  let promotions: any[] = [];

  if (digitalCardCode?.startsWith("PC-")) {


    digitalCard = await DigitalCardService.findByPromoCode(
      merchantId,
      digitalCardCode
    );


    if (!digitalCard)
      throw new Error("Digital card not found by promo code");

    promotions = await DigitalCardPromotion.find({
      digitalCardId: digitalCard._id,
    }).lean();

 

    const promo = promotions.find(
      (p: any) => p.promoCode === digitalCardCode
    );


    if (!promo) throw new Error("Promotion not found in digital card");

    appliedPromotionIds = [promo.promotionId.toString()];
  } 
  else if (digitalCardCode?.startsWith("DG-")) {


    digitalCard = await DigitalCardService.findByMerchantAndCardCode(
      merchantId,
      digitalCardCode
    );



    if (!digitalCard)
      throw new Error("Digital card not found");

    promotions = await DigitalCardPromotion.find({
      digitalCardId: digitalCard._id,
    }).lean();


  } 
  else {
    throw new Error("Invalid digitalCardCode");
  }

  // ===============================
  // 🎯 PROMO CALCULATION
  // ===============================
  let totalDiscount = 0;
  let totalGrossValue = 0;

  const promotionsDetail: any[] = [];



  for (const promoId of appliedPromotionIds) {


    const promoInCard = promotions.find(
      (p: any) => p.promotionId?.toString() === promoId
    );


    if (!promoInCard) {
      throw new Error(`Promotion ${promoId} not found in digital card`);
    }

    const promotion =
      await PromotionService.getSinglePromotionFromDB(promoId);



    if (!promotion)
      throw new Error(`Promotion ${promoId} not found`);

    const grossValue = promotion.grossValue || 0;
    const discountPercentage = promotion.discountPercentage || 0;

    const discountAmount =
      (grossValue * discountPercentage) / 100;

    totalGrossValue += grossValue;
    totalDiscount += discountAmount;

    promotionsDetail.push({
      promotionId: promoId,
      grossValue,
      discountPercentage,
      discountAmount,
    });

  }

 
  if (totalBill < totalGrossValue) {
    throw new Error(
      `Total bill (${totalBill}) is less than promotions value (${totalGrossValue})`
    );
  }

  // ===============================
  // 💰 CALCULATION
  // ===============================
  const discountedBills = parseFloat(
    (totalBill - totalDiscount).toFixed(4)
  );

  const pointDiscount = parseFloat(
    (pointRedeemed * POINT_REDEEM_RATE).toFixed(4)
  );

  const finalBill = parseFloat(
    (discountedBills - pointDiscount).toFixed(4)
  );

  const discountedBill = parseFloat(
  (totalDiscount+pointDiscount).toFixed(4)
  )
  if (finalBill < 0) {
    throw new Error("Final bill cannot be negative");
  }

  const netBillForPoint = Math.max(totalBill - totalGrossValue, 0);


  const userTier = await TierService.getBestTierForPoints(
    merchantId,
    digitalCard.lifeTimeEarnPoints || 0
  );



  const accumulationPercentage =
    userTier?.accumulationRule || 0;

  const eligibleAmount =
    (netBillForPoint * accumulationPercentage) / 100;

  const pointsEarned = parseFloat(
    (eligibleAmount / POINT_EARN_RATE).toFixed(4)
  );

 

  // ===============================
  // 🧠 SAVE SELL
  // ===============================
  // const sell = await Sell.create({
  //   merchantId,
  //   userId: digitalCard.userId,
  //   digitalCardId: digitalCard._id,
  //   digitalCardCode: digitalCard.cardCode,

  //   promotionIds: appliedPromotionIds,

  //   totalBill,
  //   totalGrossValue,
  //   totalDiscount,

  //   discountedBill: discountedBill,
  //   pointRedeemed,
  //   pointDiscount,
  //   finalBill,

  //   netBillForPoint,
  //   accumulationPercentage,
  //   eligibleAmount,
  //   pointsEarned,

  //   status: "pending",
  //   approvalExpiresAt: new Date(Date.now() + 2 * 60 * 1000),
  // });



  // ===============================
  // 📡 RESPONSE
  // ===============================
  return {
    // sellId: sell._id,
    merchantId,
    userId: digitalCard.userId,
    digitalCardId: digitalCard._id,
    digitalCardCode: digitalCard.cardCode,

    appliedPromotionIds,
    promotionsDetail,

    totalBill,
    totalGrossValue,
    totalDiscount,
    discountedBill: discountedBill,
    pointRedeemed,
    pointDiscount,
    finalBill,

    netBillForPoint,
    accumulationPercentage,
    eligibleAmount,
    pointsEarned,

    status: "pending",
  };
};





// -----------------------------
const getPendingRequests = async (userId: string) => {
  const cards =
    await DigitalCardService.findPendingRequestsByUserId(userId);

  const requests = [];

  for (const card of cards) {
    const pendingPromotions = await DigitalCardPromotion.find({
      digitalCardId: card._id,
      status: "pending",
    });

    for (const p of pendingPromotions) {
      requests.push({
        digitalCardId: card._id,
        promotionId: p.promotionId,
        cardCode: card.cardCode,
      });
    }
  }

  return requests;
};


const approvePromotion = async (
  digitalCardCode: string,
  promotionIds: string[],
  userId: string,
  sellId?: string
) => {
  const digitalCard = await DigitalCard.findOne({
    cardCode: digitalCardCode,
    userId: new Types.ObjectId(userId),
  });

  if (!digitalCard) throw new Error("Digital card not found");

  if (!sellId) {
    throw new Error("sellId is required");
  }

  const sell = await Sell.findOne({
    _id: new Types.ObjectId(sellId),
    digitalCardId: digitalCard._id,
    status: "pending",
  });

  if (!sell) throw new Error("Pending checkout not found");

  if (sell.approvalExpiresAt && sell.approvalExpiresAt < new Date()) {
    sell.status = "expired";
    await sell.save();
    throw new Error("Approval request expired (2 minutes)");
  }

  if (sell.status === "completed") {
    return {
      sellId: sell._id,
      approvedPromotions: [],
      pointsEarned: sell.pointsEarned,
      pointsRedeemed: sell.pointRedeemed,
    };
  }

  const approvedPromotions: string[] = [];

  for (const promotionId of promotionIds) {
    const promo = await DigitalCardPromotion.findOne({
      digitalCardId: digitalCard._id,
      promotionId,
    });

    if (!promo) continue;

    // stricter guard
    if (promo.status !== "pending" && promo.status !== "unused") continue;

    promo.status = "used";
    promo.usedAt = new Date();

    await promo.save();

    approvedPromotions.push(promotionId.toString());
  }

const redeemed = Number(
  Number(sell.pointRedeemed || 0).toFixed(4)
);

const earned = Number(
  Number(sell.pointsEarned || 0).toFixed(4)
);

  digitalCard.availablePoints = Number(
    ((digitalCard.availablePoints || 0) - redeemed + earned).toFixed(4)
  );

  digitalCard.lifeTimeEarnPoints = Number(
    ((digitalCard.lifeTimeEarnPoints || 0) + earned).toFixed(4)
  );

  if (digitalCard.lifeTimeEarnPoints < 0) {
    digitalCard.lifeTimeEarnPoints = 0;
  }

  await digitalCard.save();

  sell.status = "completed";
  await sell.save();

  return {
    sellId: sell._id,
    approvedPromotions,
    pointsEarned: earned,
    pointsRedeemed: redeemed,
  };
};



const approvePromotionReject = async (
  digitalCardCode: string,
  promotionIds: string[],
  userId: string,
  sellId?: string
) => {
  const digitalCard = await DigitalCard.findOne({
    cardCode: digitalCardCode,
    userId: new Types.ObjectId(userId),
  });

  if (!digitalCard) throw new Error("Digital card not found");

  const sellQuery: any = {
    digitalCardId: digitalCard._id,
    status: "pending",
  };

  if (sellId) sellQuery._id = sellId;

  const sell = await Sell.findOne(sellQuery);

  if (!sell) throw new Error("Pending checkout not found");

  if (sell.status === "rejected") {
    return {
      sellId: sell._id,
      rejectedPromotions: [],
    };
  }

  const rejectedPromotions: string[] = [];

  for (const promotionId of promotionIds) {
    const promo = await DigitalCardPromotion.findOne({
      digitalCardId: digitalCard._id,
      promotionId,
    });

    if (!promo) continue;

    // 🔥 FIX: only revert if it was used
    if (promo.status === "used") {
      promo.status = "pending";
      promo.usedAt = undefined;
      await promo.save();
    }

    rejectedPromotions.push(promotionId.toString());
  }

  sell.status = "rejected";
  await sell.save();

  return {
    sellId: sell._id,
    rejectedPromotions,
  };
};





// Service
const getPointsHistory = async (
  digitalCardId: string,
  type: "all" | "earn" | "use" = "all"
) => {
  if (!Types.ObjectId.isValid(digitalCardId)) {
    throw new Error("Invalid digitalCardId");
  }

  const typeSanitized = type.trim().toLowerCase() as
    | "all"
    | "earn"
    | "use";

  const query: any = {
    digitalCardId: new Types.ObjectId(digitalCardId),
    status: "completed",
  };

  if (typeSanitized === "earn") query.pointsEarned = { $gt: 0 };
  if (typeSanitized === "use") query.pointRedeemed = { $gt: 0 };

  const history = await Sell.find(query)
    .sort({ createdAt: -1 })
    .populate("merchantId", "businessName shopName firstName profile")
    .lean();

  const result: any[] = [];

  for (const tx of history) {
    const merchant = tx.merchantId as any;

    const merchantName =
      merchant?.businessName ||
      merchant?.shopName ||
      merchant?.firstName ||
      "";

    const ratingDoc =
      tx.promotionIds?.length > 0 &&
      (await RatingService.findRatingByPromotionDigitalCard(
        tx.promotionIds[0]?.toString() || "",
        tx.digitalCardId?.toString() || ""
      ));

    const ratingValue = ratingDoc ? ratingDoc.rating : 0;

    const baseEntry = {
      id: tx._id,
      digitalCardId: tx.digitalCardId,
      totalBill: tx.totalBill,
      discountedBill: tx.discountedBill,
      date: tx.createdAt,
      merchant: merchantName,
      merchantProfile: merchant?.profile,
      merchantId: merchant?._id,
      rating: ratingValue,
      promotionIds:
        tx.promotionIds?.length > 0
          ? tx.promotionIds[0].toString()
          : "",
    };

    if (
      (typeSanitized === "all" || typeSanitized === "earn") &&
      (Number(tx.pointsEarned) ?? 0) > 0
    ) {
      result.push({
        ...baseEntry,
        isEarn: true,
        type: "earn",
        points: tx.pointsEarned,
      });
    }

    if (
      (typeSanitized === "all" || typeSanitized === "use") &&
      (Number(tx.pointRedeemed) ?? 0) > 0
    ) {
      result.push({
        ...baseEntry,
        isEarn: false,
        type: "use",
        points: tx.pointRedeemed,
      });
    }
  }

  return result;
};




const getUserFullTransactions = async (
  userId: string,
  merchantId: string,
  type: "all" | "earn" | "use" = "all",
  page = 1,
  limit = 20
) => {
  if (!Types.ObjectId.isValid(userId)) {
    throw new Error("Invalid user ID");
  }

  if (!Types.ObjectId.isValid(merchantId)) {
    throw new Error("Invalid merchant ID");
  }

  const skip = (page - 1) * limit;

  const query: any = {
    userId: new Types.ObjectId(userId),
    merchantId: new Types.ObjectId(merchantId), // 🔥 main fix
    status: "completed",
  };

  if (type === "earn") query.pointsEarned = { $gt: 0 };
  if (type === "use") query.pointRedeemed = { $gt: 0 };

  const [total, transactions] = await Promise.all([
    Sell.countDocuments(query),
    Sell.find(query)
      .populate("merchantId", "name businessName shopName")
      .populate("userId", "firstName lastName email phone profile customUserId country")
      .populate("digitalCardId", "cardCode availablePoints")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  return {
    transactions,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

// -----------------------------
// EXPORT SERVICE
// -----------------------------
const getMerchantSalesFromDB = async (merchantId: string, query: Record<string, any>) => {
  const period = query.period as string;
  const monthParam = query.month as string;
  const now = new Date();
  let dateFilter: any = {};
  const currentYear = now.getUTCFullYear();

  if (monthParam && Number(monthParam) >= 1 && Number(monthParam) <= 12) {
    const month = Number(monthParam) - 1;
    const startOfMonth = new Date(Date.UTC(currentYear, month, 1, 0, 0, 0));
    const endOfMonth = new Date(Date.UTC(currentYear, month + 1, 0, 23, 59, 59, 999));
    dateFilter.createdAt = { $gte: startOfMonth, $lte: endOfMonth };
  } else if (period === "day") {
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    dateFilter.createdAt = { $gte: startOfDay };
  } else if (period === "week") {
    const startOfWeek = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - now.getUTCDay()));
    dateFilter.createdAt = { $gte: startOfWeek };
  } else if (period === "month") {
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    dateFilter.createdAt = { $gte: startOfMonth };
  }

  const searchTerm = (query.searchTerm as string)?.toLowerCase() || "";
  const page = Number(query.page) || 1;
  const limit = Number(query.limit) || 10;
  const skip = (page - 1) * limit;

  let sales = await Sell.find({ merchantId, status: "completed", ...dateFilter })
    .populate("userId", "firstName lastName email phone profile customUserId")
    .populate("digitalCardId", "cardCode")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  if (!sales || sales.length === 0) {
    return { transactionData: [], total: 0 };
  }

  if (searchTerm) {
    sales = sales.filter((tx: any) => {
      const u = tx.userId || {};
      const c = tx.digitalCardId || {};
      return (
        u.firstName?.toLowerCase().includes(searchTerm) ||
        u.lastName?.toLowerCase().includes(searchTerm) ||
        u.email?.toLowerCase().includes(searchTerm) ||
        u.phone?.toLowerCase().includes(searchTerm) ||
        c.cardCode?.toLowerCase().includes(searchTerm)
      );
    });
  }

  const total = await Sell.countDocuments({
    merchantId,
    status: "completed",
    ...dateFilter,
  });

  const transactionData = sales.map((tx: any) => ({
    _id: tx.userId?._id,
    name: `${tx.userId?.firstName || ""} ${tx.userId?.lastName || ""}`.trim(),
    email: tx.userId?.email,
    phone: tx.userId?.phone,
    profile: tx.userId?.profile,
    customUserId: tx.userId?.customUserId,
    totalTransactions: 1,
    totalPointsEarned: tx.pointsEarned || 0,
    totalPointsRedeemed: tx.pointRedeemed || 0,
    totalBilled: tx.totalBill || 0,
    finalBilled: tx.discountedBill || 0,
    cardIds: tx.digitalCardId?.cardCode || "",
    status: tx.status || "",
    createdAt: tx.createdAt,
  }));

  return { transactionData, total };
};

const getMerchantCustomersListFromDB = async (merchantId: string, query: Record<string, any>) => {
  const period = query.period as string;
  const now = new Date();
  let dateFilter: any = {};

  if (period === "day") {
    const startOfDayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    dateFilter = { createdAt: { $gte: startOfDayUTC } };
  } else if (period === "week") {
    const endOfDayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
    const startOf7DaysUTC = new Date(endOfDayUTC);
    startOf7DaysUTC.setUTCDate(startOf7DaysUTC.getUTCDate() - 6);
    dateFilter = { createdAt: { $gte: startOf7DaysUTC, $lte: endOfDayUTC } };
  } else if (period === "month") {
    const startOfMonthUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    dateFilter = { createdAt: { $gte: startOfMonthUTC } };
  }

  const searchTerm = ((query.search as string) || (query.searchTerm as string) || "").toLowerCase().trim();

  const sales = await Sell.find({
    merchantId,
    status: "completed",
    ...dateFilter,
  })
    .populate("userId", "firstName lastName email phone profile customUserId country")
    .populate("digitalCardId", "cardCode availablePoints tier createdAt")
    .populate("merchantId", "businessName shopName firstName")
    .lean();

  if (!sales.length) {
    return { customers: [], total: 0 };
  }

  let filteredSales = sales;
  if (searchTerm) {
    filteredSales = sales.filter((tx: any) => {
      const user = tx.userId || {};
      const fullName = `${user.firstName || ""} ${user.lastName || ""}`.toLowerCase();
      const customId = (user.customUserId || "").toLowerCase();
      const country = (user.country || "").toLowerCase();
      return fullName.includes(searchTerm) || customId.includes(searchTerm) || country.includes(searchTerm);
    });
  }

  const userIds = [...new Set(filteredSales.map((tx: any) => tx.userId?._id?.toString()).filter(Boolean))];
  const ratings = await RatingService.findRatingsByMerchantAndUsers(
    merchantId,
    userIds
  );

  const ratingMap: Record<string, { total: number; count: number; comments: string[] }> = {};
  ratings.forEach((r: any) => {
    const userId = r.userId.toString();
    if (!ratingMap[userId]) {
      ratingMap[userId] = { total: 0, count: 0, comments: [] };
    }
    ratingMap[userId].total += r.rating;
    ratingMap[userId].count += 1;
    if (r.comment) ratingMap[userId].comments.push(r.comment);
  });

  const userMap: Record<string, any> = {};
  filteredSales.forEach((tx: any) => {
    const user = tx.userId;
    if (!user?._id) return;
    const userId = user._id.toString();

    if (!userMap[userId]) {
      const ratingData = ratingMap[userId];
      userMap[userId] = {
        _id: userId,
        name: `${user.firstName} ${user.lastName || ""}`.trim(),
        email: user.email,
        phone: user.phone,
        country: user.country,
        profile: user.profile,
        customUserId: user.customUserId || "",
        totalTransactions: 0,
        totalPointsEarned: 0,
        totalPointsRedeemed: 0,
        totalBilled: 0,
        finalBilled: 0,
        availablePoints: tx.digitalCardId?.availablePoints || 0,
        tier: tx.digitalCardId?.tier || "",
        createdAt: tx.digitalCardId?.createdAt || null,
        salesRep: tx.merchantId?.businessName || tx.merchantId?.shopName || tx.merchantId?.firstName || "",
        rating: ratingData ? Number((ratingData.total / ratingData.count).toFixed(1)) : null,
        ratingCount: ratingData?.count || 0,
        ratingComments: ratingData?.comments || [],
      };
    }

    userMap[userId].totalTransactions += 1;
    userMap[userId].totalPointsEarned += tx.pointsEarned || 0;
    userMap[userId].totalPointsRedeemed += tx.pointRedeemed || 0;
    userMap[userId].totalBilled += tx.totalBill || 0;
    userMap[userId].finalBilled += tx.discountedBill || 0;
  });

  const customers = Object.values(userMap);
  const page = Number(query.page) || 1;
  const limit = Number(query.limit) || 10;
  const skip = (page - 1) * limit;

  const paginatedCustomers = customers.slice(skip, skip + limit);
  return { customers: paginatedCustomers, total: customers.length };
};

const getRecentMerchantCustomersListFromDB = async (merchantId: string, query: Record<string, any>) => {
  const searchTerm = ((query.searchTerm as string) || "").toLowerCase().trim();

  const pipeline: any[] = [
    {
      $match: {
        merchantId: new Types.ObjectId(merchantId),
        status: "completed",
      },
    },
    {
      $group: {
        _id: "$userId",
        firstPurchaseAt: { $min: "$createdAt" },
        totalTransactions: { $sum: 1 },
        totalPointsEarned: { $sum: "$pointsEarned" },
        totalPointsRedeemed: { $sum: "$pointRedeemed" },
        totalBilled: { $sum: "$totalBill" },
        finalBilled: { $sum: "$discountedBill" },
      },
    },
    { $sort: { firstPurchaseAt: -1 } },
    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "_id",
        as: "user",
      },
    },
    { $unwind: "$user" },
    {
      $match: searchTerm
        ? {
            $or: [
              { "user.firstName": { $regex: searchTerm, $options: "i" } },
              { "user.lastName": { $regex: searchTerm, $options: "i" } },
              { "user.customUserId": { $regex: searchTerm, $options: "i" } },
              { "user.country": { $regex: searchTerm, $options: "i" } },
            ],
          }
        : {},
    },
  ];

  const customers = await Sell.aggregate(pipeline);
  const page = Number(query.page) || 1;
  const limit = Number(query.limit) || 10;
  const skip = (page - 1) * limit;

  const paginated = customers.slice(skip, skip + limit).map((c: any) => ({
    _id: c._id,
    name: `${c.user.firstName} ${c.user.lastName || ""}`.trim(),
    email: c.user.email,
    phone: c.user.phone,
    country: c.user.country,
    customUserId: c.user.customUserId,
    firstPurchaseAt: c.firstPurchaseAt,
    totalTransactions: c.totalTransactions,
    totalPointsEarned: c.totalPointsEarned,
    totalPointsRedeemed: c.totalPointsRedeemed,
    totalBilled: c.totalBilled,
    finalBilled: c.finalBilled,
  }));

  return { customers: paginated, total: customers.length };
};

const exportMerchantCustomersFromDB = async (
  merchantId: string,
  query: Record<string, any>
) => {
  // Resolve root merchant if logged in user is a sub merchant
  const merchant = await User.findById(merchantId).select(
    "_id merchantId isSubMerchant"
  );

  if (!merchant) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Merchant not found");
  }

  if (merchant.isSubMerchant) {
    if (!merchant.merchantId) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Parent merchant not found"
      );
    }

    merchantId = merchant.merchantId.toString();
  }

  const period = query.period as string;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let dateFilter: any = {};

  if (period === "day") {
    dateFilter = {
      createdAt: { $gte: today },
    };
  } else if (period === "week") {
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());

    dateFilter = {
      createdAt: { $gte: startOfWeek },
    };
  } else if (period === "month") {
    const startOfMonth = new Date(today);
    startOfMonth.setDate(1);

    dateFilter = {
      createdAt: { $gte: startOfMonth },
    };
  }

  const queryBuilder = new QueryBuilder(
    Sell.find({
      merchantId: new Types.ObjectId(merchantId),
      status: "completed",
      ...dateFilter,
    }),
    query
  )
    .filter()
    .search(["userId.firstName", "userId.lastName"])
    .sort()
    .populate(["userId", "digitalCardId", "merchantId"], {
      userId:
        "firstName lastName email phone profile customUserId country",
      digitalCardId: "cardCode availablePoints createdAt",
      merchantId: "businessName shopName firstName",
    });

  const sales = await queryBuilder.modelQuery.lean();

  const tiers = await TierService.getActiveTiersSortedByThreshold();

  const getCurrentTier = (points: number) => {
    let currentTier = "";

    for (const tier of tiers) {
      if (points >= tier.pointsThreshold) {
        currentTier = tier.name;
      }
    }

    return currentTier;
  };

  const userIds = [
    ...new Set(
      sales
        .map((tx: any) => tx.userId?._id?.toString())
        .filter(Boolean)
    ),
  ];

  const ratings = await RatingService.findRatingsByMerchantAndUsers(
    merchantId,
    userIds
  );

  const ratingMap: Record<string, any> = {};

  ratings.forEach((r: any) => {
    ratingMap[r.userId.toString()] = r;
  });

  const userMap: Record<string, any> = {};

  sales.forEach((tx: any) => {
    const user = tx.userId;

    if (!user?._id) return;

    const userId = user._id.toString();
    const availablePoints = tx.digitalCardId?.availablePoints || 0;

    if (!userMap[userId]) {
      userMap[userId] = {
        Name: `${user.firstName} ${user.lastName || ""}`.trim(),
        Email: user.email,
        Phone: user.phone,
        Country: user.country,
        CustomID: user.customUserId || "",
        TotalTransactions: 0,
        TotalPointsEarned: 0,
        TotalPointsRedeemed: 0,
        TotalBilled: 0,
        FinalBilled: 0,
        AvailablePoints: availablePoints,
        Tier: getCurrentTier(availablePoints),
        CreatedAt: tx.digitalCardId?.createdAt || null,
        SalesRep:
          tx.merchantId?.businessName ||
          tx.merchantId?.shopName ||
          tx.merchantId?.firstName ||
          "",
        Rating: ratingMap[userId]?.rating || null,
        RatingComment: ratingMap[userId]?.comment || null,
      };
    }

    userMap[userId].TotalTransactions += 1;
    userMap[userId].TotalPointsEarned += tx.pointsEarned || 0;
    userMap[userId].TotalPointsRedeemed += tx.pointRedeemed || 0;
    userMap[userId].TotalBilled += tx.totalBill || 0;
    userMap[userId].FinalBilled += tx.discountedBill || 0;
  });

  return Object.values(userMap);
};


const getLastPendingSellFromDB = async (userId: string) => {
  const now = new Date();
  const lastPendingSell = await Sell.findOne({
    userId,
    status: "pending",
    approvalExpiresAt: { $gte: now },
  })
    .sort({ createdAt: -1 })
    .populate("promotionIds");

  if (!lastPendingSell) return null;

  const digitalCard = await DigitalCard.findById(
    lastPendingSell.digitalCardId
  );

  return {
    ...lastPendingSell.toObject(),
    sellId: lastPendingSell._id,
    digitalCardId: digitalCard?._id,
    digitalCardCode: digitalCard?.cardCode || "",
  };
};

export const SellService = {
  checkout,
  requestApproval,
  getPendingRequests,
  approvePromotion,
  approvePromotionReject,
  getPointsHistory,
  getUserFullTransactions,
  getMerchantSalesFromDB,
  getMerchantCustomersListFromDB,
  getRecentMerchantCustomersListFromDB,
  exportMerchantCustomersFromDB,
  getLastPendingSellFromDB,
};
