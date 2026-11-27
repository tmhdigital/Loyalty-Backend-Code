import { Types } from "mongoose";
import { StatusCodes } from "http-status-codes";
import ApiError from "../../../errors/ApiErrors";
import { errorLogger } from "../../../shared/logger";
import { RecentViewedPromotion } from "./recentViewedPromotion.model";
import { Promotion } from "../merchant/promotionMerchant/promotionMerchant.model";
import { DigitalCard, DigitalCardPromotion } from "../customer/digitalCard/digitalCard.model";

// How many promotions the home screen shows.
export const RECENT_VIEWED_DISPLAY_LIMIT = 10;
// How many ids we keep. Larger than the display limit so that when some
// viewed promotions expire, older still-available ones can fill their place.
// Expired ids are NOT deleted: a merchant may extend the end date or
// re-activate the promotion, and it should then show up again.
export const RECENT_VIEWED_MAX_STORED = 30;

const DUPLICATE_KEY_ERROR = 11000;

/**
 * A promotion is shown only while the merchant still offers it:
 * active status and today inside its start/end window.
 * (Deleted promotions simply no longer exist.)
 */
const isPromotionAvailable = (promotion: any, now: Date): boolean =>
  promotion.status === "active" &&
  new Date(promotion.startDate) <= now &&
  new Date(promotion.endDate) >= now;

const toObjectId = (id: string | Types.ObjectId): Types.ObjectId => {
  if (!Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid promotion id");
  }
  return new Types.ObjectId(id);
};

/**
 * Moves the promotion to the front of the user's list (or adds it),
 * removes any duplicate and caps the list — in ONE atomic update,
 * so concurrent requests cannot create duplicates.
 */
const upsertRecentViewed = (userId: Types.ObjectId, promotionId: Types.ObjectId) =>
  RecentViewedPromotion.findOneAndUpdate(
    { userId },
    [
      {
        $set: {
          items: {
            $slice: [
              {
                $concatArrays: [
                  [promotionId],
                  {
                    $filter: {
                      input: { $ifNull: ["$items", []] },
                      cond: { $ne: ["$$this", promotionId] },
                    },
                  },
                ],
              },
              RECENT_VIEWED_MAX_STORED,
            ],
          },
          createdAt: { $ifNull: ["$createdAt", "$$NOW"] },
          updatedAt: "$$NOW",
        },
      },
    ],
    { upsert: true, new: true, timestamps: false }
  ).lean();

const addRecentViewedToDB = async (
  userId: string | Types.ObjectId,
  promotionId: string | Types.ObjectId
) => {
  const uId = new Types.ObjectId(userId);
  const pId = toObjectId(promotionId);

  const exists = await Promotion.exists({ _id: pId });
  if (!exists) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Promotion not found");
  }

  try {
    return await upsertRecentViewed(uId, pId);
  } catch (error: any) {
    // Two first-ever requests for the same user can race on the upsert;
    // the loser hits the unique userId index. The document exists now,
    // so a single retry is a plain update.
    if (error?.code === DUPLICATE_KEY_ERROR) {
      return upsertRecentViewed(uId, pId);
    }
    throw error;
  }
};

const getRecentViewedFromDB = async (userId: string | Types.ObjectId) => {
  const uId = new Types.ObjectId(userId);

  const [record, digitalCard] = await Promise.all([
    RecentViewedPromotion.findOne({ userId: uId }).select("items").lean(),
    DigitalCard.findOne({ userId: uId }).select("_id").lean(),
  ]);

  const ids = record?.items ?? [];
  if (!ids.length) return [];

  const [promotions, existingCardPromotions] = await Promise.all([
    Promotion.find({ _id: { $in: ids } })
      .populate({ path: "merchantId", model: "User", select: "website" })
      .lean(),
    digitalCard
      ? DigitalCardPromotion.find({ digitalCardId: digitalCard._id })
          .select("promotionId")
          .lean()
      : Promise.resolve([]),
  ]);

  const promotionById = new Map(promotions.map((p: any) => [p._id.toString(), p]));
  const addedPromotionIds = new Set(
    existingCardPromotions.map((p: any) => p.promotionId?.toString())
  );

  const now = new Date();
  const result: any[] = [];
  const deletedIds: Types.ObjectId[] = [];

  // Walk the stored order (newest first) so the list keeps view order.
  for (const id of ids) {
    const promotion = promotionById.get(id.toString());

    if (!promotion) {
      deletedIds.push(id);
      continue;
    }

    if (
      result.length < RECENT_VIEWED_DISPLAY_LIMIT &&
      isPromotionAvailable(promotion, now)
    ) {
      result.push({
        ...promotion,
        isPromotionAdded: addedPromotionIds.has(promotion._id.toString()),
      });
    }
  }

  // Deleted promotions can never come back — drop their ids in the
  // background. Failure here must not affect the response.
  if (deletedIds.length) {
    RecentViewedPromotion.updateOne(
      { userId: uId },
      { $pull: { items: { $in: deletedIds } } }
    ).catch((error) =>
      errorLogger.error("[RecentViewed] Failed to remove deleted promotions", error)
    );
  }

  return result;
};

export const RecentViewedPromotionService = {
  addRecentViewedToDB,
  getRecentViewedFromDB,
};
