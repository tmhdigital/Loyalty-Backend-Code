import { StatusCodes } from 'http-status-codes';
import ApiError from '../../../errors/ApiErrors';
import { User } from '../user/user.model';
import { ResetToken } from '../resetToken/resetToken.model';

import { sendOtp } from '../../../config/veevoTechOtp';
import { emailHelper } from '../../../helpers/emailHelper';
import { emailTemplate } from '../../../shared/emailTemplate';

import bcrypt from 'bcrypt';

import { IAuthResetPassword, IChangePassword } from '../../../types/auth';
import { JwtPayload } from 'jsonwebtoken';
import generateOTP from '../../../utils/generateOTP';
import config from '../../../config';

export const forgetPasswordToDB = async (identifier: string) => {
  const isEmail = identifier.includes('@');
  const user = isEmail ? await User.findOne({ email: identifier }) : await User.findOne({ phone: identifier });
  if (!user) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }
  if (user.isDeleted) {
    throw new ApiError(StatusCodes.FORBIDDEN, "Your account has been deleted/suspended. Please create a new account with a new email or contact support.");
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

export const resetPasswordToDB = async (token: string, payload: IAuthResetPassword) => {
  const { newPassword, confirmPassword } = payload;
  const isExistToken = await ResetToken.isExistToken(token);
  if (!isExistToken) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'You are not authorized');
  }
  const isExistUser = await User.findById(isExistToken.user).select('+password +previousPasswords +authentication');
  if (!isExistUser?.authentication?.isResetPassword) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, "You don't have permission to change the password. Please click again to 'Forgot Password'");
  }
  const isValid = await ResetToken.isExpireToken(token);
  if (!isValid) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Token expired, Please click again to the forget password');
  }
  if (newPassword !== confirmPassword) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "New password and Confirm password doesn't match!");
  }
  if (isExistUser.previousPasswords?.length) {
    for (const prev of isExistUser.previousPasswords) {
      const match = await bcrypt.compare(newPassword, prev.hash);
      if (match) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'You cannot reuse an old password!');
      }
    }
  }
  const hashPassword = await bcrypt.hash(newPassword, Number(config.bcrypt_salt_rounds));
  isExistUser.previousPasswords = isExistUser.previousPasswords || [];
  if (isExistUser.password) {
    isExistUser.previousPasswords.push({ hash: isExistUser.password, changedAt: new Date() });
  }
  if (isExistUser.password) {
    const isSameAsCurrent = await bcrypt.compare(newPassword, isExistUser.password);
    if (isSameAsCurrent) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Please provide a different password from the previous one');
    }
  }
  await User.findByIdAndUpdate(isExistUser._id, {
    password: hashPassword,
    authentication: { isResetPassword: false },
    previousPasswords: isExistUser.previousPasswords,
  });
  return { success: true };
};

export const changePasswordToDB = async (user: JwtPayload, payload: IChangePassword) => {
  const { currentPassword, newPassword, confirmPassword } = payload;
  const isExistUser = await User.findById(user._id).select('+password');
  if (!isExistUser) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }
  // Current password is mandatory whenever one exists; accounts without a
  // password (Google sign-up) can set their first one directly.
  if (isExistUser.password) {
    if (!currentPassword || !(await User.isMatchPassword(currentPassword, isExistUser.password))) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Password is incorrect');
    }
  }
  if (currentPassword === newPassword) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Please give different password from current password');
  }
  if (newPassword !== confirmPassword) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Password and Confirm password doesn't matched");
  }
  if (isExistUser.previousPasswords?.length) {
    for (const prev of isExistUser.previousPasswords) {
      const match = await bcrypt.compare(newPassword, prev.hash);
      if (match) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'You cannot reuse an old password!');
      }
    }
  }
  const hashPassword = await bcrypt.hash(newPassword, Number(config.bcrypt_salt_rounds));
  isExistUser.previousPasswords = isExistUser.previousPasswords || [];
  if (isExistUser.password) {
    isExistUser.previousPasswords.push({ hash: isExistUser.password, changedAt: new Date() });
  }
  await User.findOneAndUpdate({ _id: user._id }, { password: hashPassword, previousPasswords: isExistUser.previousPasswords }, { new: true });
};
