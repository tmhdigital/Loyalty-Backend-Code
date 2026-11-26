import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";
import ApiError from "../../../errors/ApiErrors";
import { AppVersion } from "./appVersion.model";
import { IAppVersion } from "./appVersion.interface";
import { DEFAULT_APP_VERSIONS } from "./appVersion.constants";

// Creates any of the 4 rows that do not exist yet. Existing rows are never
// touched ($setOnInsert), so admin edits survive.
const ensureDefaults = async () => {
  try {
    await AppVersion.bulkWrite(
      DEFAULT_APP_VERSIONS.map((row) => ({
        updateOne: {
          filter: { app: row.app, platform: row.platform },
          update: { $setOnInsert: row },
          upsert: true,
        },
      })),
      { ordered: false }
    );
  } catch (error: any) {
    // Two first-time requests racing on the unique index: the other one
    // already created the row, which is all we need.
    if (error?.code !== 11000) throw error;
  }
};

// Public: what the mobile app needs to decide on the update popup
const checkVersion = async (app: string, platform: string) => {
  let row = await AppVersion.findOne({ app, platform }).lean();
  if (!row) {
    await ensureDefaults();
    row = await AppVersion.findOne({ app, platform }).lean();
  }
  if (!row) return null;

  return {
    latestVersion: row.latestVersion,
    minSupportedVersion: row.minSupportedVersion,
    storeUrl: row.storeUrl,
    releaseNotes: row.releaseNotes ?? "",
  };
};

// Admin: all 4 rows
const getAll = async () => {
  await ensureDefaults();
  return AppVersion.find()
    .sort({ app: 1, platform: 1 })
    .populate("updatedBy", "name email")
    .lean();
};

// Admin: edit one row. Returns the row before and after for the audit log.
const update = async (
  id: string,
  payload: Pick<
    IAppVersion,
    "latestVersion" | "minSupportedVersion" | "storeUrl" | "releaseNotes"
  >,
  adminId?: string
) => {
  const before = await AppVersion.findById(id).lean();
  if (!before) {
    throw new ApiError(StatusCodes.NOT_FOUND, "App version not found");
  }

  const after = await AppVersion.findByIdAndUpdate(
    id,
    {
      $set: {
        ...payload,
        ...(adminId && Types.ObjectId.isValid(adminId)
          ? { updatedBy: new Types.ObjectId(adminId) }
          : {}),
      },
    },
    { new: true }
  ).lean();

  return { before, after };
};

export const AppVersionService = { checkVersion, getAll, update };
