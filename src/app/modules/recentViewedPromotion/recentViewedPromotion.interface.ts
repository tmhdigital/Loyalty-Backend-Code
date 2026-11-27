import { Types, Document, Model } from "mongoose";

export interface IRecentViewedPromotion extends Document {
  userId: Types.ObjectId;
  // Promotion ids, newest first.
  items: Types.ObjectId[];
}

export type RecentViewedPromotionModel = Model<IRecentViewedPromotion>;
