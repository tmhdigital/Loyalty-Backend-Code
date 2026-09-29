import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";
import ApiError from "../../../errors/ApiErrors";
import Referral from "../referral/referral.model";
import { User } from "./user.model";

/**
 * Links a user to the referrer who owns `referralId` (their referenceId).
 * Shared by email sign-up and the Google sign-up referral step.
 */
export const applyReferralToUser = async (
  userId: Types.ObjectId | string,
  referralId: string
) => {
  const user = await User.findById(userId).select("referredInfo");
  if (!user) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }
  if (user.referredInfo?.referredId) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Referral already applied");
  }

  const referrer = await User.findOne({ referenceId: referralId });
  if (!referrer) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Referred Id Invalid!");
  }
  if (referrer._id.equals(user._id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "You cannot use your own referral ID");
  }

  const referredInfo = {
    referredId: referralId,
    referredBy: `${referrer.firstName} ${referrer.lastName || ""}`,
    referredUserId: referrer._id, // ✅ ObjectId stored for referral logic
  };

  await User.findByIdAndUpdate(user._id, { $set: { referredInfo } });

  await Referral.create({
    referrer: referrer._id,
    referredUser: user._id,
  });
};
