import { StatusCodes } from 'http-status-codes';
import ApiError from '../../../errors/ApiErrors';
import { User } from '../user/user.model';
import generateOTP from '../../../utils/generateOTP';
import { sendOtp } from '../../../config/veevoTechOtp';
import { emailHelper } from '../../../helpers/emailHelper';
import { emailTemplate } from '../../../shared/emailTemplate';
import { jwtHelper } from '../../../helpers/jwtHelper';
import config from '../../../config';
import cryptoToken from '../../../utils/cryptoToken';
import { ResetToken } from '../resetToken/resetToken.model';
import * as crypto from 'crypto';

export const resendOtpToDB = async (identifier: string) => {
  const isEmail = identifier.includes('@');
  const user = isEmail
    ? await User.findOne({ email: identifier }).select('+authentication')
    : await User.findOne({ phone: identifier }).select('+authentication');

  if (!user) {
    throw new ApiError(StatusCodes.BAD_REQUEST, `User doesn't exist with this ${isEmail ? 'email' : 'phone'}`);
  }

  const otp = generateOTP();
  user.authentication = user.authentication || {};
  user.authentication.isResetPassword = true;

  if (isEmail) {
    user.authentication.emailOTP = { code: otp, expireAt: new Date(Date.now() + 3 * 60000) };
    user.authentication.resetVia = 'email';
  } else {
    user.authentication.phoneOTP = { code: otp, expireAt: new Date(Date.now() + 3 * 60000) };
    user.authentication.resetVia = 'phone';
  }

  await user.save();

  if (isEmail) {
    const values = { name: user.firstName ?? '', lastName: user.lastName ?? '', otp, email: user.email ?? '' };
    const template = emailTemplate.resetPassword(values);
    await emailHelper.sendEmail(template);
  } else {
    await sendOtp(user.phone!, otp.toString());
  }

  return { identifier, via: user.authentication.resetVia };
};

export const verifyOtpToDB = async (payload: {
  identifier: string;
  oneTimeCode: number;
}) => {
  const { identifier, oneTimeCode } = payload;

  const isEmail = identifier.includes("@");

  const user = isEmail
    ? await User.findOne({ email: identifier }).select("+authentication")
    : await User.findOne({ phone: identifier }).select("+authentication");

  if (!user) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist.");
  }

  if (!oneTimeCode) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Please provide OTP sent to your identifier"
    );
  }

  const otpInfo = isEmail
    ? user.authentication?.emailOTP
    : user.authentication?.phoneOTP;

  if (!otpInfo || otpInfo.code !== oneTimeCode) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "You provided wrong OTP");
  }

  if (!otpInfo.expireAt || otpInfo.expireAt < new Date()) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "OTP already expired, request new one"
    );
  }

  if (!user.verified) user.verified = true;

  if (user.authentication) {
    if (isEmail) delete user.authentication.emailOTP;
    else delete user.authentication.phoneOTP;

    user.authentication.isResetPassword = true;
  } else {
    user.authentication = { isResetPassword: true } as any;
  }

  // ===============================
  // 🔥 ADD LOGIN-LIKE SESSION HERE
  // ===============================
  const sessionId = crypto.randomUUID();

  const hashedSessionId = crypto
    .createHash("sha256")
    .update(sessionId)
    .digest("hex");

  user.sessionId = hashedSessionId;

  await user.save();

  // ===============================
  // 🔥 SAME RESPONSE TOKENS
  // ===============================
  const accessToken = jwtHelper.createToken(
    {
      id: user._id,
      role: user.role,
      email: user.email,
      phoneNumber: user.phone,
      sessionId,
    },
    config.jwt.jwt_secret!,
    config.jwt.jwt_expire_in!
  );

  const resetToken = cryptoToken();
  await ResetToken.create({
    user: user._id,
    token: resetToken,
    expireAt: new Date(Date.now() + 5 * 60 * 1000),
  });

  return {
    message: "OTP verified successfully",
    accessToken,
    resetToken,
  };
};

export const verifyEmailToDB = async (payload: { email: string; oneTimeCode: number }) => {
  const { email, oneTimeCode } = payload;

  if (!email || !email.includes('@')) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Valid email is required');
  }

  const user = await User.findOne({ email }).select('+authentication');
  if (!user) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist.");
  }

  if (user.verified) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Email already verified');
  }

  if (!oneTimeCode) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Please provide OTP sent to your email');
  }

  const otpInfo = user.authentication?.emailOTP;
  if (!otpInfo || otpInfo.code !== oneTimeCode) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'You provided wrong OTP');
  }

  if (!otpInfo.expireAt || otpInfo.expireAt < new Date()) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'OTP already expired, request new one');
  }

  user.verified = true;
  if (user.authentication) {
    delete user.authentication.emailOTP;
  }

  await user.save();

  return { message: 'Email verified successfully' };
};
