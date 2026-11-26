import { Model, Types } from "mongoose";
import { APP_PLATFORMS, APP_TYPES } from "./appVersion.constants";

export interface IAppVersion {
  _id?: Types.ObjectId;
  app: APP_TYPES;
  platform: APP_PLATFORMS;
  latestVersion: string;
  minSupportedVersion: string;
  storeUrl: string;
  releaseNotes?: string;
  updatedBy?: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

export type AppVersionModel = Model<IAppVersion>;
