import { Schema, model } from "mongoose";
import { AppVersionModel, IAppVersion } from "./appVersion.interface";
import { APP_PLATFORMS, APP_TYPES } from "./appVersion.constants";

const appVersionSchema = new Schema<IAppVersion, AppVersionModel>(
  {
    app: { type: String, required: true, enum: Object.values(APP_TYPES) },
    platform: {
      type: String,
      required: true,
      enum: Object.values(APP_PLATFORMS),
    },
    latestVersion: { type: String, required: true },
    minSupportedVersion: { type: String, required: true },
    storeUrl: { type: String, default: "" },
    releaseNotes: { type: String, default: "" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

// One row per app + platform
appVersionSchema.index({ app: 1, platform: 1 }, { unique: true });

export const AppVersion = model<IAppVersion, AppVersionModel>(
  "AppVersion",
  appVersionSchema
);
