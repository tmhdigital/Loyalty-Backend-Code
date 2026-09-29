import { StatusCodes } from 'http-status-codes';
import { JwtPayload, Secret } from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import config from '../../../config';
import ApiError from '../../../errors/ApiErrors';
import { USER_STATUS } from '../../../enums/user';

import { jwtHelper } from '../../../helpers/jwtHelper';

import { User } from '../user/user.model';


// Imported sub‑services
import { loginUserFromDB, logoutUserFromDB } from './login.service';
import { forgetPasswordToDB, resetPasswordToDB, changePasswordToDB } from './password.service';
import { resendOtpToDB, verifyOtpToDB, verifyEmailToDB } from './otp.service';
import { googleLoginToDB } from './google-oauth.service';
import {
  sendPhoneOtpToDB,
  verifyPhoneOtpToDB,
  applyReferralToDB,
  sendDeleteAccountOtpToDB,
} from './account-onboarding.service';
import { uploadDocumentImagesToDB } from './document.service';
import { archiveUserInDB } from './archive.service';

// Existing functions retained in this file
export const deleteUserFromDB = async (user: JwtPayload, password: string): Promise<void> => {
  // 1️⃣ Find user
  const isExistUser = await User.findById(user.id).select("+password");

  if (!isExistUser) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }

  // 2️⃣ Password required check
  if (!password) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Password is required to delete account");
  }

  // 3️⃣ Ensure user password exists
  if (!isExistUser.password) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User has no password set");
  }

  // 4️⃣ Password match check
  const isMatch = await User.isMatchPassword(password, isExistUser.password);
  if (!isMatch) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Password is incorrect");
  }


  await User.findByIdAndUpdate(user.id, {
    $set: {
      status: USER_STATUS.SUSPENDED,
      isDeleted: true,
      deletedAt: new Date(),
    },
  }, { new: true });
};

/**
 * Password accounts confirm with their password; accounts without one
 * (Google sign-up) confirm with the SMS code from /delete-account/send-otp.
 */
export const deleteOwnUserAccount = async (
  userId: string,
  { password, oneTimeCode }: { password?: string; oneTimeCode?: number }
) => {
  if (!userId) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User ID is required");
  }
  const user = await User.findById(userId).select("+password +authentication");
  if (!user) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }

  if (user.password) {
    if (!password) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Password is required");
    }
    const isMatch = await User.isMatchPassword(password, user.password);
    if (!isMatch) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Password is incorrect");
    }
  } else {
    const otpInfo = user.authentication?.phoneOTP;
    if (!oneTimeCode) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Verification code is required");
    }
    if (!otpInfo?.code || otpInfo.code !== oneTimeCode) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "You provided wrong OTP");
    }
    if (!otpInfo.expireAt || otpInfo.expireAt < new Date()) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "OTP already expired, request new one");
    }
  }
  await User.findByIdAndUpdate(userId, {
    $set: { status: USER_STATUS.SUSPENDED, isDeleted: true, deletedAt: new Date() },
  }, { new: true });
};

export const newAccessTokenToUser = async (refreshToken: string) => {
  if (!refreshToken) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Refresh token is required!");
  }

  // 1️⃣ verify refresh token
  const verifyUser = jwtHelper.verifyToken(
    refreshToken,
    config.jwt.jwtRefreshSecret as Secret
  ) as JwtPayload & { sessionId: string };

  // 2️⃣ find user
  const user = await User.findById(verifyUser.id);

  if (!user) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, "Unauthorized access");
  }

  // 3️⃣ session check (IMPORTANT)
  if (!user.sessionId) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, "Session missing");
  }

  // 4️⃣ compare session (hashed vs plain)
  const hashedIncoming = crypto
    .createHash("sha256")
    .update(verifyUser.sessionId)
    .digest("hex");

  const isSessionValid = user.sessionId.startsWith("$2")
    ? await bcrypt.compare(verifyUser.sessionId, user.sessionId)  // purane bcrypt sessions
    : user.sessionId === hashedIncoming;                          // naye SHA-256 sessions

  if (!isSessionValid) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, "Invalid session");
  }

  // 5️⃣ generate new access token
  const accessToken = jwtHelper.createToken(
    {
      id: user._id,
      role: user.role,
      email: user.email,
      sessionId: verifyUser.sessionId,
    },
    config.jwt.jwt_secret as Secret,
    config.jwt.jwt_expire_in as string
  );

  return {
    accessToken,
  };
};

export const AuthService = {
  loginUserFromDB,
  forgetPasswordToDB,
  resetPasswordToDB,
  changePasswordToDB,
  newAccessTokenToUser,
  deleteUserFromDB,
  deleteOwnUserAccount,
  resendOtpToDB,
  verifyOtpToDB,
  verifyEmailToDB,
  uploadDocumentImagesToDB,
  archiveUserInDB,
  googleLoginToDB,
  logoutUserFromDB,
  sendPhoneOtpToDB,
  verifyPhoneOtpToDB,
  applyReferralToDB,
  sendDeleteAccountOtpToDB,
};