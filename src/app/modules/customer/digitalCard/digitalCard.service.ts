import mongoose, { Types } from "mongoose";

import { DigitalCard, DigitalCardPromotion } from "./digitalCard.model";
import { generateCardCode } from "./generateCardCode";
import { Promotion } from "../../merchant/promotionMerchant/promotionMerchant.model";
import { MerchantCustomer } from "../../merchant/merchantCustomer/merchantCustomer.model";






const addPromotionToDigitalCard = async (
  userId: string,
  promotionId: string
) => {
  try {
    const promotion = await Promotion.findById(promotionId);
    if (!promotion) {
      throw new Error("Promotion not found");
    }

    const merchantId = promotion.merchantId;
    const promotionObjectId = new Types.ObjectId(promotionId);

    // -------------------------------
    // Merchant Customer handling
    // -------------------------------
    let merchantCustomer = await MerchantCustomer.findOne({
      merchantId,
      customerId: userId,
    });

    if (!merchantCustomer) {

      merchantCustomer = await MerchantCustomer.create({
        merchantId,
        customerId: userId,
        segment: "new_customer",
      });
    }

    const userSegment = merchantCustomer.segment;
    const promoSegment = promotion.customerSegment;

    if (
      promoSegment !== "all_customer" &&
      promoSegment !== userSegment
    ) {

      throw new Error(
        "This promotion is not applicable for your customer segment"
      );
    }

    // -------------------------------
    // Get Digital Card
    // -------------------------------


    const digitalCard = await createOrGetDigitalCard(
      userId,
      merchantId.toString()
    );

    const generatePromoCode = () =>
      `PC-${Math.floor(100000 + Math.random() * 900000)}`;

    // -------------------------------
    // Check duplicate
    // -------------------------------


    const alreadyAdded = await DigitalCardPromotion.findOne({
      digitalCardId: digitalCard._id,
      promotionId: promotionObjectId,
    });


    if (!alreadyAdded) {
      const promoCode = generatePromoCode();

      const payload = {
        digitalCardId: digitalCard._id,
        promotionId: promotionObjectId,
        status: "pending",
        promoCode,
      };

      try {
        await DigitalCardPromotion.create(payload);
      } catch (createError: any) {

        throw createError;
      }
    }


    const promotions = await DigitalCardPromotion.find({
      digitalCardId: digitalCard._id,
    }).populate({
      path: "promotionId",
      model: "PromotionMerchant",
    });



    const allPromotions = promotions.map((promo) => ({
      cardCode: digitalCard.cardCode,
      promoCode: promo.promoCode,
      status: promo.status,
      usedAt: promo.usedAt,
      promotion: promo.promotionId,
    }));


    return {
      totalPromotions: allPromotions.length,
      promotions: allPromotions,
    };
  } catch (error: any) {

    throw error;
  }
};


const getUserAddedPromotions = async (
  userId: string,
  query: Record<string, any>
) => {
  const { page = 1, limit = 10, searchTerm } = query;

  const pageNum = Number(page) || 1;
  const perPage = Number(limit) || 10;

  const today = new Date();

  const pipeline: any[] = [
    // Step 1: Join Digital Card
    {
      $lookup: {
        from: "digitalcards",
        localField: "digitalCardId",
        foreignField: "_id",
        as: "digitalCard",
      },
    },
    {
      $unwind: "$digitalCard",
    },

    // Step 2: Filter by User
    {
      $match: {
        "digitalCard.userId": new mongoose.Types.ObjectId(userId),
      },
    },

    // Step 3: Join Promotion
    {
      $lookup: {
        from: "promotionmerchants",
        localField: "promotionId",
        foreignField: "_id",
        as: "promotion",
      },
    },
    {
      $unwind: "$promotion",
    },

    // Step 4: Remove expired promotions
    {
      $match: {
        $or: [
          { "promotion.endDate": { $gte: today } },
          { "promotion.endDate": null },
          { "promotion.endDate": { $exists: false } },
        ],
      },
    },

    // Step 5: Join Merchant
    {
      $lookup: {
        from: "users",
        localField: "promotion.merchantId",
        foreignField: "_id",
        as: "merchant",
      },
    },
    {
      $unwind: {
        path: "$merchant",
        preserveNullAndEmptyArrays: true,
      },
    },

    // Step 6: Search
    ...(searchTerm
      ? [
          {
            $match: {
              "promotion.name": {
                $regex: searchTerm,
                $options: "i",
              },
            },
          },
        ]
      : []),

    // Step 7: Sort latest first
    {
      $sort: {
        createdAt: -1,
      },
    },

    // Step 8: Pagination
    {
      $facet: {
        metadata: [{ $count: "total" }],
        data: [
          { $skip: (pageNum - 1) * perPage },
          { $limit: perPage },
          {
            $project: {
              _id: 0,

              // SAME RESPONSE FORMAT
              cardCode: "$digitalCard.cardCode",
              status: "$status",
              usedAt: "$usedAt",
              promoCode: "$promoCode",
              promotion: "$promotion",
              merchantBusinessName: "$merchant.businessName",
              merchantWebsite: "$merchant.website",
            },
          },
        ],
      },
    },
  ];

  const result = await DigitalCardPromotion.aggregate(pipeline);

  const total = result?.[0]?.metadata?.[0]?.total || 0;
  const promotions = result?.[0]?.data || [];

  return {
    data: {
      totalPromotions: total,
      promotions,
    },
    pagination: {
      total,
      page: pageNum,
      limit: perPage,
      totalPage: Math.ceil(total / perPage) || 1,
    },
  };
};

const getUserDigitalCards = async (
  userId: string,
  query: Record<string, any>
) => {
  const { searchTerm, page = 1, limit = 10 } = query;
  const pageNum = Math.max(1, Number(page));
  const perPage = Math.max(1, Number(limit));

  const baseMatch = { userId: new mongoose.Types.ObjectId(userId) };

  // pipeline before facet: match -> lookup -> unwind -> optional search
  const pipeline: any[] = [
    { $match: baseMatch },
    {
      $lookup: {
        from: "users",
        localField: "merchantId",
        foreignField: "_id",
        as: "merchant",
      },
    },
    // keep docs if merchant missing to avoid accidental drops
    { $unwind: { path: "$merchant", preserveNullAndEmptyArrays: true } },
  ];

  if (searchTerm) {
    pipeline.push({
      $match: {
        $or: [
          { cardCode: { $regex: searchTerm, $options: "i" } },
          { "merchant.businessName": { $regex: searchTerm, $options: "i" } },
          { "merchant.firstName": { $regex: searchTerm, $options: "i" } },
        ],
      },
    });
  }

  // facet to get total count AND paginated data in one query
  pipeline.push({
    $facet: {
      metadata: [{ $count: "total" }],
      data: [
        { $skip: (pageNum - 1) * perPage },
        { $limit: perPage },
        {
          $project: {
            _id: 1,
            userId: 1,
            cardCode: 1,
            availablePoints: 1,
            promotions: 1,
            createdAt: 1,
            updatedAt: 1,
            merchant: {
              _id: "$merchant._id",
              firstName: "$merchant.firstName",
              businessName: "$merchant.businessName",
              profile: "$merchant.profile",
            },
          },
        },
      ],
    },
  });

  // run aggregation
  const aggResult = await DigitalCard.aggregate(pipeline);

  // aggResult is an array with a single object { metadata: [...], data: [...] }
  const metadata = aggResult[0]?.metadata ?? [];
  const data = aggResult[0]?.data ?? [];

  const total = metadata[0]?.total ?? 0;
  const totalPage = Math.ceil(total / perPage) || 1;

  const formattedCards = data.map((card: any) => ({
    _id: card._id,
    userId: card.userId,
    merchantId: card.merchant,
    cardCode: card.cardCode,
    availablePoints: parseFloat((card.availablePoints ?? 0).toFixed(4)),
    promotions: Array.isArray(card.promotions)
      ? card.promotions
          .map((p: any) => p?.promotionId?.toString())
          .filter(Boolean)
      : [],
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
  }));

  return {
    data: { totalDigitalCards: total, digitalCards: formattedCards },
    pagination: {
      total,
      page: pageNum,
      limit: perPage,
      totalPage,
    },
  };
};

const getPromotionsOfDigitalCard = async (digitalCardId: string) => {
  const digitalCard = await DigitalCard.findById(digitalCardId);

  if (!digitalCard) {
    throw new Error("Digital Card not found");
  }

  const promotions = await DigitalCardPromotion.find({
    digitalCardId: digitalCard._id,
  }).populate({
    path: "promotionId",
    model: "PromotionMerchant",
  });

  const formattedPromotions = promotions.map((promo) => ({
    cardCode: digitalCard.cardCode,
    promoCode: promo.promoCode,
    status: promo.status,
    usedAt: promo.usedAt,
    promotion: promo.promotionId,
  }));

  return {
    totalPromotions: formattedPromotions.length,
    promotions: formattedPromotions,
  };
};



const getMerchantDigitalCardWithPromotions = async (
  merchantId: string,
  code: string
) => {

  let searchedByPromoCode = false;
  let digitalCard: any = null;

  /* ------------------------------------------------
     1️⃣ Search by DigitalCard.cardCode
  ------------------------------------------------ */

  digitalCard = await DigitalCard.findOne({
    merchantId,
    cardCode: code,
  });

  /* ------------------------------------------------
     2️⃣ If not found, search by promotions.promoCode
  ------------------------------------------------ */

  if (!digitalCard) {
    searchedByPromoCode = true;

    const promoMatch = await DigitalCardPromotion.findOne({
      promoCode: code,
      status: { $in: ["pending", "unused"] },
      usedAt: null,
    }).populate("promotionId");

    if (!promoMatch) {
      return null;
    }

    digitalCard = await DigitalCard.findOne({
      _id: promoMatch.digitalCardId,
      merchantId,
    });

    if (!digitalCard) {
      return null;
    }
  }

  /* ------------------------------------------------
     3️⃣ Load ALL promotions separately (FIX)
  ------------------------------------------------ */

  const promotions = await DigitalCardPromotion.find({
    digitalCardId: digitalCard._id,
  }).populate("promotionId");

  /* ------------------------------------------------
     4️⃣ Apply SAME business logic (UNCHANGED)
  ------------------------------------------------ */

  const validPromotions = promotions
    .map((item: any) => {

      if (!item.promotionId) return null;

      if (!(item.status === "pending" || item.status === "unused" || item.usedAt)) {
        return null;
      }

      const today = new Date();
      const startDate = new Date(item.promotionId.startDate);
      const endDate = new Date(item.promotionId.endDate);

      if (today < startDate) return null;
      if (today > endDate) return null;

      const dayMap: any = {
        0: "sun",
        1: "mon",
        2: "tue",
        3: "wed",
        4: "thu",
        5: "fri",
        6: "sat",
      };

      const todayDay = dayMap[today.getDay()];
      const availableDays = item.promotionId.availableDays || [];

      const isValidToday =
        availableDays.length === 0 ||
        availableDays.includes("all") ||
        availableDays.includes(todayDay);

      if (!isValidToday) return null;

      if (searchedByPromoCode && item.promoCode !== code) {
        return null;
      }

      return {
        status: item.status,
        usedAt: item.usedAt,
        promoCode: item.promoCode,
        ...item.promotionId.toObject(),
      };
    })
    .filter(Boolean);

  /* ------------------------------------------------
     5️⃣ RESPONSE (UNCHANGED LOGIC STYLE)
  ------------------------------------------------ */

  if (validPromotions.length === 0) {

    if (searchedByPromoCode) {
      return null;
    }

    return {
      digitalCard: {
        ...digitalCard.toObject(),
        promotions: [],
      },
    };
  }

  return {
    digitalCard: {
      ...digitalCard.toObject(),
      promotions: validPromotions,
    },
  };
};

const createOrGetDigitalCard = async (userId: string, merchantId: string) => {
  let digitalCard = await DigitalCard.findOne({
    userId: new Types.ObjectId(userId),
    merchantId: new Types.ObjectId(merchantId),
  });

  if (digitalCard) return digitalCard;

  digitalCard = await DigitalCard.create({
    userId: new Types.ObjectId(userId),
    merchantId: new Types.ObjectId(merchantId),
    cardCode: generateCardCode(),
    promotions: [],
  });

  return digitalCard;
};

const findByMerchantAndCardCode = async (
  merchantId: string,
  cardCode: string,
  session?: mongoose.ClientSession
) => {
  const query = DigitalCard.findOne({ merchantId, cardCode });
  if (session) {
    query.session(session);
  }
  return query;
};

const findByPromoCode = async (
  merchantId: string,
  promoCode: string
) => {
  return DigitalCard.findOne({
    merchantId,
    "promotions.promoCode": promoCode,
    "promotions.status": { $in: ["pending", "unused"] },
    "promotions.usedAt": null,
  });
};

const findByCardCodeAndUserId = async (
  cardCode: string,
  userId: string
) => {
  return DigitalCard.findOne({
    cardCode,
    userId: new Types.ObjectId(userId),
  });
};

const findPendingRequestsByUserId = async (userId: string) => {
  return DigitalCard.find({
    userId: new Types.ObjectId(userId),
    "promotions.status": "pending",
  });
};

export const DigitalCardService = {
  addPromotionToDigitalCard,
  getUserAddedPromotions,
  getUserDigitalCards,
  getPromotionsOfDigitalCard,
  getMerchantDigitalCardWithPromotions,
  createOrGetDigitalCard,
  findByMerchantAndCardCode,
  findByPromoCode,
  findByCardCodeAndUserId,
  findPendingRequestsByUserId,
};
