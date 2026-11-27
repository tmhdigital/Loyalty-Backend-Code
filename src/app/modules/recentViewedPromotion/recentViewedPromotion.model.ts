import mongoose from "mongoose";
import { IRecentViewedPromotion } from "./recentViewedPromotion.interface";

const recentViewedPromotionSchema = new mongoose.Schema<IRecentViewedPromotion>(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Newest first. Size is capped atomically in the service
    // (RECENT_VIEWED_MAX_STORED), so no pre-save hook is needed.
    items: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "PromotionMerchant",
      },
    ],
  },
  { timestamps: true }
);

// One document per user.
recentViewedPromotionSchema.index({ userId: 1 }, { unique: true });
recentViewedPromotionSchema.index({ updatedAt: -1 });

export const RecentViewedPromotion = mongoose.model<IRecentViewedPromotion>(
  "RecentViewedPromotion",
  recentViewedPromotionSchema
);
