import { OAuth2Client, TokenPayload } from 'google-auth-library';
import { User } from '../user/user.model';


import { StatusCodes } from 'http-status-codes';
import ApiError from '../../../errors/ApiErrors';

import { generateCustomUserId } from '../user/user.utils';
import { createUniqueReferralId } from '../../../utils/generateReferralId';
import { USER_ROLES, USER_STATUS } from '../../../enums/user';
import config from '../../../config';
import { createLoginSession } from './login.service';

const googleClient = new OAuth2Client(config.social.google_client_id);

/**
 * Customer app Google sign-in. Creates the account on first login, or links
 * Google to an existing account with the same email (auto-link), then starts
 * a normal session so the response matches password login.
 */
export const googleLoginToDB = async (idToken: string, fcmToken?: string) => {
  let payload: TokenPayload | undefined;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: config.social.google_client_id,
    });
    payload = ticket.getPayload();
  } catch {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid Google token');
  }

  if (!payload?.email || !payload.email_verified) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid or unverified Google account');
  }
  const email = payload.email.toLowerCase();
  const googleId = payload.sub;
  let isFirstLogin = false;
  let user: any = await User.findOne({ email }).select('+password');

  if (user?.googleId && user.googleId !== googleId) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Google account mismatch');
  }

  if (!user) {
    const [referenceId, customUserId] = await Promise.all([
      createUniqueReferralId(),
      generateCustomUserId(USER_ROLES.USER),
    ]);
    user = await User.create({
      referenceId,
      customUserId,
      email,
      firstName: payload.given_name || payload.name || email.split('@')[0],
      ...(payload.given_name && payload.family_name && { lastName: payload.family_name }),
      ...(payload.picture && { profile: payload.picture }),
      googleId,
      authProviders: ['google'],
      verified: true,
      role: USER_ROLES.USER,
    });
    isFirstLogin = true;
  } else {
    // Same checks as password login
    if (user.isDeleted || user.status === USER_STATUS.SUSPENDED) {
      throw new ApiError(StatusCodes.FORBIDDEN, 'Your account has been deleted/suspended.');
    }
    if (user.role !== USER_ROLES.USER) {
      throw new ApiError(StatusCodes.FORBIDDEN, 'Google sign-in is only available for customer accounts.');
    }
    if (user.status !== USER_STATUS.ACTIVE) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Your account is not active.');
    }

    // Auto-link: Google has verified this email, so both login methods open this account
    if (!user.googleId || !user.verified) {
      await User.findByIdAndUpdate(user._id, {
        $set: { googleId, verified: true },
        $addToSet: { authProviders: 'google' },
      });
    }
  }

  const session = await createLoginSession(user, fcmToken);

  return {
    ...session,
    user: {
      ...session.user,
      email,
      hasPassword: Boolean(user.password),
      // Google sign-up is finished only once a phone number is verified
      needsPhone: !user.phone,
      hasReferral: Boolean(user.referredInfo?.referredId),
    },
    isFirstLogin,
  };
};
