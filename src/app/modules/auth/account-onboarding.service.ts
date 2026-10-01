import { StatusCodes } from 'http-status-codes';
import ApiError from '../../../errors/ApiErrors';
import { User } from '../user/user.model';
import { sendOtp } from '../../../config/veevoTechOtp';
import generateOTP from '../../../utils/generateOTP';
import { applyReferralToUser } from '../user/applyReferral';

const OTP_TTL_MS = 3 * 60000; // 3 min, same as sign-up

const PHONE_TAKEN = 'This number is already registered. Sign in with it instead.';

/** Throws if a live account owns `phone`; frees it from abandoned/deleted accounts. */
const assertPhoneAvailable = async (phone: string, userId: string) => {
  const owner = await User.findOne({ phone, _id: { $ne: userId } });
  if (!owner) return;
  if (owner.verified && !owner.isDeleted) {
    throw new ApiError(StatusCodes.BAD_REQUEST, PHONE_TAKEN);
  }
  // Unverified (abandoned) sign-up or deleted account: release the number
  await User.findByIdAndUpdate(owner._id, { $unset: { phone: 1 } });
};

/** Sends an SMS code to confirm the phone for an account that has none (Google sign-up). */
export const sendPhoneOtpToDB = async (userId: string, phone: string) => {
  const user = await User.findById(userId).select('+authentication');
  if (!user) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }
  if (user.phone) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Phone number already added');
  }

  await assertPhoneAvailable(phone, userId);

  const otp = generateOTP();
  user.authentication = user.authentication || {};
  user.authentication.phoneOTP = { code: otp, expireAt: new Date(Date.now() + OTP_TTL_MS) };
  // Saved on the account only after the code is confirmed
  user.authentication.pendingPhone = phone;
  await user.save();

  await sendOtp(phone, otp.toString());

  return { phone };
};

/** Confirms the SMS code and saves the pending phone on the account. */
export const verifyPhoneOtpToDB = async (userId: string, oneTimeCode: number) => {
  const user = await User.findById(userId).select('+authentication');
  if (!user) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }

  const pendingPhone = user.authentication?.pendingPhone;
  const otpInfo = user.authentication?.phoneOTP;
  if (!pendingPhone || !otpInfo?.code) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Please request a new code');
  }
  if (otpInfo.code !== oneTimeCode) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'You provided wrong OTP');
  }
  if (!otpInfo.expireAt || otpInfo.expireAt < new Date()) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'OTP already expired, request new one');
  }

  // Someone may have registered the number while the code was pending
  await assertPhoneAvailable(pendingPhone, userId);

  await User.findByIdAndUpdate(userId, {
    $set: {
      phone: pendingPhone,
      'authentication.pendingPhone': null,
      'authentication.phoneOTP': { code: null, expireAt: null },
    },
  });

  return { phone: pendingPhone };
};

/** Referral step of Google sign-up (email sign-up sends it with the sign-up form). */
export const applyReferralToDB = async (userId: string, referralId: string) => {
  await applyReferralToUser(userId, referralId.trim());
  return null;
};

/** Sends an SMS code to confirm deleting an account that has no password. */
export const sendDeleteAccountOtpToDB = async (userId: string) => {
  const user = await User.findById(userId).select('+authentication');
  if (!user) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }
  if (!user.phone) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'No phone number on this account');
  }

  const otp = generateOTP();
  user.authentication = user.authentication || {};
  user.authentication.phoneOTP = { code: otp, expireAt: new Date(Date.now() + OTP_TTL_MS) };
  await user.save();

  await sendOtp(user.phone, otp.toString());

  return { phone: user.phone };
};
