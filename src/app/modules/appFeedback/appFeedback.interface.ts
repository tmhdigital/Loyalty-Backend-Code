import { Types } from "mongoose";

export enum FEEDBACK_CATEGORY {
  BUG = "bug",
  SUGGESTION = "suggestion",
  COMPLIMENT = "compliment",
  OTHER = "other",
}

export enum FEEDBACK_STATUS {
  NEW = "new",
  REVIEWED = "reviewed",
  RESOLVED = "resolved",
}

export enum FEEDBACK_PLATFORM {
  ANDROID = "android",
  IOS = "ios",
  OTHER = "other",
}

export interface IAppFeedback {
  userId: Types.ObjectId;
  rating: number;
  category: FEEDBACK_CATEGORY;
  comment?: string;
  appVersion?: string;
  platform?: FEEDBACK_PLATFORM;
  deviceModel?: string;
  status: FEEDBACK_STATUS;
  adminNote?: string;
  createdAt?: Date;
  updatedAt?: Date;
}
