import crypto from "crypto";
import { Secret } from "jsonwebtoken";
import { StatusCodes } from "http-status-codes";

import config from "../../../config";
import ApiError from "../../../errors/ApiErrors";
import { jwtHelper } from "../../../helpers/jwtHelper";
import { User } from "../user/user.model"; // adjust import path as needed
import { ILoginData } from "../../../types/auth";
import { USER_STATUS } from "../../../enums/user";

export const loginUserFromDB = async (
  payload: ILoginData & {
    device: string;
    fcmToken?: string;
  }
) => {

  const { identifier, password, device, fcmToken } = payload;
  const user: any = await User.findOne({
    $or: [{ email: identifier }, { phone: identifier }],
  }).select("+password");

  if (!user) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }
  if (user.isDeleted || user.status === USER_STATUS.SUSPENDED) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "Your account has been deleted/suspended."
    );
  }

  if (!user.verified) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Please verify your account before login"
    );
  }

  if (user.status !== USER_STATUS.ACTIVE) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Your account is not active."
    );
  }

  const isPasswordValid =
    password && (await User.isMatchPassword(password, user.password));

  if (!isPasswordValid) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Password is incorrect!");
  }

  const DEVICE_ROLE_MAP: Record<string, string[]> = {
    merchant: ["MERCHANT", "VIEW_MERCHANT", "ADMIN_MERCHANT"],
    admin: ["ADMIN", "SUPER_ADMIN", "ADMIN_REP", "ADMIN_SELL", "VIEW_ADMIN"],
    user: ["USER"],
  };

  const allowedRoles = DEVICE_ROLE_MAP[device?.toLowerCase()];



  if (!allowedRoles) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid device type");
  }

  if (!allowedRoles.includes(user.role)) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      `Your role '${user.role}' is not allowed to login from a ${device} device`
    );
  }

  // session
  const sessionId = crypto.randomUUID();

  const hashedSessionId = crypto.createHash("sha256").update(sessionId).digest("hex");

  // tokens
  const accessToken = jwtHelper.createToken(
    {
      id: user._id,
      role: user.role,
      email: user.email,
      sessionId,
    },
    config.jwt.jwt_secret as Secret,
    config.jwt.jwt_expire_in as string
  );

  const refreshToken = jwtHelper.createToken(
    {
      id: user._id,
      role: user.role,
      email: user.email,
      sessionId,
    },
    config.jwt.jwtRefreshSecret as Secret,
    config.jwt.jwtRefreshExpiresIn as string
  );

  await User.findByIdAndUpdate(user._id, {
    sessionId: hashedSessionId,
    ...(fcmToken && { fcmToken }),
  });

  return {
    accessToken,
    refreshToken,
    user: {
      id: user._id,
      role: user.role,
      pages: user.pages || [],
      subscription: user.subscription,
      businessName: user.businessName || "",
      isUserWaiting: user.isUserWaiting,
      location: user.location ?? {
        type: "Point",
        coordinates: [0, 0],
      },
    },
  };
};

export const logoutUserFromDB = async (userId: string) => {
  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      "User not found"
    );
  }

  await User.findByIdAndUpdate(userId, {
    $unset: {
      sessionId: 1,
      fcmToken: 1,
    },
  });

  return null;
};
