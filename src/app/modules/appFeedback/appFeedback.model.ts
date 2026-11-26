import { Schema, model } from "mongoose";
import {
  FEEDBACK_CATEGORY,
  FEEDBACK_PLATFORM,
  FEEDBACK_STATUS,
  IAppFeedback,
} from "./appFeedback.interface";

const appFeedbackSchema = new Schema<IAppFeedback>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    rating: { type: Number, min: 1, max: 5, required: true },
    category: {
      type: String,
      enum: Object.values(FEEDBACK_CATEGORY),
      required: true,
    },
    comment: { type: String, trim: true, maxlength: 1000, default: "" },
    appVersion: { type: String, trim: true, maxlength: 30 },
    platform: { type: String, enum: Object.values(FEEDBACK_PLATFORM) },
    deviceModel: { type: String, trim: true, maxlength: 100 },
    status: {
      type: String,
      enum: Object.values(FEEDBACK_STATUS),
      default: FEEDBACK_STATUS.NEW,
    },
    adminNote: { type: String, trim: true, maxlength: 1000, default: "" },
  },
  { timestamps: true }
);

// Admin list: newest first, optionally filtered by status / category
appFeedbackSchema.index({ createdAt: -1 });
appFeedbackSchema.index({ status: 1, createdAt: -1 });
appFeedbackSchema.index({ category: 1, createdAt: -1 });
appFeedbackSchema.index({ userId: 1, createdAt: -1 });

export const AppFeedback = model<IAppFeedback>(
  "AppFeedback",
  appFeedbackSchema
);
