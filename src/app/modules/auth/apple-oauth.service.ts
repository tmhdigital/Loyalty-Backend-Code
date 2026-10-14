import crypto from 'crypto';
import axios from 'axios';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { StatusCodes } from 'http-status-codes';
import { User } from '../user/user.model';
import ApiError from '../../../errors/ApiErrors';
import { generateCustomUserId } from '../user/user.utils';
import { createUniqueReferralId } from '../../../utils/generateReferralId';
import { USER_ROLES, USER_STATUS } from '../../../enums/user';
import config from '../../../config';
import { logger } from '../../../shared/logger';
import { createLoginSession } from './login.service';

const APPLE_ISSUER = 'https://appleid.apple.com';
const KEYS_TTL_MS = 6 * 60 * 60 * 1000;

// RSA public key as listed at https://appleid.apple.com/auth/keys
type AppleJwk = { kid: string; kty: string; alg: string; use: string; n: string; e: string };
type AppleTokenPayload = JwtPayload & {
  email?: string;
  email_verified?: boolean | string;
  nonce?: string;
};

let cachedKeys: { keys: AppleJwk[]; fetchedAt: number } | null = null;

/** Apple's signing key for `kid`; refetched on a miss because Apple rotates keys. */
const getApplePublicKey = async (kid: string) => {
  const isFresh = cachedKeys && Date.now() - cachedKeys.fetchedAt < KEYS_TTL_MS;
  let jwk = isFresh ? cachedKeys!.keys.find((k) => k.kid === kid) : undefined;

  if (!jwk) {
    const { data } = await axios.get(`${APPLE_ISSUER}/auth/keys`, { timeout: 10000 });
    cachedKeys = { keys: data.keys, fetchedAt: Date.now() };
    jwk = cachedKeys.keys.find((k) => k.kid === kid);
  }
  if (!jwk) throw new Error(`Apple signing key ${kid} not found`);

  return crypto.createPublicKey({ key: jwk as any, format: 'jwk' });
};

/** Verifies the identityToken from the iOS app: Apple signature, issuer, our bundle ID, expiry, nonce. */
const verifyAppleIdentityToken = async (identityToken: string, rawNonce?: string) => {
  const decoded = jwt.decode(identityToken, { complete: true });
  if (!decoded || typeof decoded === 'string' || !decoded.header.kid) {
    throw new Error('Malformed Apple identity token');
  }

  const publicKey = await getApplePublicKey(decoded.header.kid);
  const payload = jwt.verify(identityToken, publicKey, {
    algorithms: ['RS256'],
    issuer: APPLE_ISSUER,
    audience: config.apple.bundle_id,
  }) as AppleTokenPayload;

  // The app sends Apple sha256(rawNonce); the token must carry that hash
  if (rawNonce) {
    const hashed = crypto.createHash('sha256').update(rawNonce).digest('hex');
    if (payload.nonce !== hashed) throw new Error('Apple token nonce mismatch');
  }

  return payload;
};

/**
 * Client secret for Apple's token/revoke APIs, signed with the .p8 key.
 * Null when the key isn't configured: login still works, revoke is skipped.
 */
const createAppleClientSecret = () => {
  const { team_id, key_id, private_key, bundle_id } = config.apple;
  if (!team_id || !key_id || !private_key || !bundle_id) return null;

  return jwt.sign({}, private_key, {
    algorithm: 'ES256',
    keyid: key_id,
    issuer: team_id,
    audience: APPLE_ISSUER,
    subject: bundle_id,
    expiresIn: '5m',
  });
};

/** Trades the one-time authorizationCode for a refresh token, needed later to revoke. */
const exchangeAuthorizationCode = async (authorizationCode: string) => {
  const clientSecret = createAppleClientSecret();
  if (!clientSecret) return null;

  try {
    const { data } = await axios.post(
      `${APPLE_ISSUER}/auth/token`,
      new URLSearchParams({
        client_id: config.apple.bundle_id as string,
        client_secret: clientSecret,
        code: authorizationCode,
        grant_type: 'authorization_code',
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 }
    );
    return (data?.refresh_token as string) || null;
  } catch (err) {
    logger.error('Apple authorization code exchange failed', err);
    return null;
  }
};

/**
 * Revokes Sign in with Apple for a deleted account (App Store guideline 5.1.1(v)).
 * Never throws: a failed revoke must not block the account deletion.
 */
export const revokeAppleToken = async (refreshToken?: string) => {
  if (!refreshToken) return;

  const clientSecret = createAppleClientSecret();
  if (!clientSecret) {
    logger.warn('Apple revoke skipped: APPLE_TEAM_ID / APPLE_KEY_ID / APPLE_PRIVATE_KEY not set');
    return;
  }

  try {
    await axios.post(
      `${APPLE_ISSUER}/auth/revoke`,
      new URLSearchParams({
        client_id: config.apple.bundle_id as string,
        client_secret: clientSecret,
        token: refreshToken,
        token_type_hint: 'refresh_token',
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 }
    );
  } catch (err) {
    logger.error('Apple token revoke failed', err);
  }
};

type AppleLoginInput = {
  identityToken: string;
  rawNonce?: string;
  authorizationCode?: string;
  // Apple sends the name only on the first sign-in, so the app forwards it
  firstName?: string;
  lastName?: string;
  fcmToken?: string;
};

/**
 * Customer app Sign in with Apple. Same rules and response as Google login:
 * creates the account on first login, or links Apple to an existing account
 * with the same verified email, then starts a normal session.
 */
export const appleLoginToDB = async ({
  identityToken,
  rawNonce,
  authorizationCode,
  firstName,
  lastName,
  fcmToken,
}: AppleLoginInput) => {
  // Without the bundle ID the audience check would be skipped
  if (!config.apple.bundle_id) {
    throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Apple sign-in is not configured');
  }

  let payload: AppleTokenPayload;
  try {
    payload = await verifyAppleIdentityToken(identityToken, rawNonce);
  } catch (err) {
    logger.error('Apple identity token verification failed', err);
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid Apple token');
  }

  const appleId = payload.sub;
  if (!appleId) throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid Apple token');

  const email = payload.email?.toLowerCase();
  const emailVerified = payload.email_verified === true || payload.email_verified === 'true';

  let isFirstLogin = false;
  // Returning Apple users are found by appleId: Apple may omit the email later
  let user: any = await User.findOne({ appleId }).select('+password');

  if (!user && email) {
    user = await User.findOne({ email }).select('+password');
    if (user?.appleId && user.appleId !== appleId) {
      throw new ApiError(StatusCodes.UNAUTHORIZED, 'Apple account mismatch');
    }
    if (user && !emailVerified) {
      throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid or unverified Apple account');
    }
  }

  if (!user) {
    if (!email) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        'Apple did not share an email. Please allow email sharing and try again.'
      );
    }
    const [referenceId, customUserId] = await Promise.all([
      createUniqueReferralId(),
      generateCustomUserId(USER_ROLES.USER),
    ]);
    user = await User.create({
      referenceId,
      customUserId,
      email,
      firstName: firstName?.trim() || email.split('@')[0],
      ...(lastName?.trim() && { lastName: lastName.trim() }),
      appleId,
      authProviders: ['apple'],
      verified: true,
      role: USER_ROLES.USER,
    });
    isFirstLogin = true;
  } else {
    // Same checks as password and Google login
    if (user.isDeleted || user.status === USER_STATUS.SUSPENDED) {
      throw new ApiError(StatusCodes.FORBIDDEN, 'Your account has been deleted/suspended.');
    }
    if (user.role !== USER_ROLES.USER) {
      throw new ApiError(StatusCodes.FORBIDDEN, 'Apple sign-in is only available for customer accounts.');
    }
    if (user.status !== USER_STATUS.ACTIVE) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Your account is not active.');
    }

    // Auto-link: Apple has verified this email, so both login methods open this account
    if (!user.appleId || !user.verified) {
      await User.findByIdAndUpdate(user._id, {
        $set: { appleId, verified: true },
        $addToSet: { authProviders: 'apple' },
      });
    }

    // Apple sends the name only on the first sign-in. If it was lost earlier
    // (the account got the email-prefix fallback), save it now.
    const emailPrefix = user.email?.split('@')[0];
    if (firstName?.trim() && user.firstName === emailPrefix) {
      await User.findByIdAndUpdate(user._id, {
        $set: {
          firstName: firstName.trim(),
          ...(lastName?.trim() && { lastName: lastName.trim() }),
        },
      });
    }
  }

  // Keep a refresh token so the account delete can revoke Apple access
  if (authorizationCode) {
    const appleRefreshToken = await exchangeAuthorizationCode(authorizationCode);
    if (appleRefreshToken) {
      await User.updateOne({ _id: user._id }, { $set: { appleRefreshToken } });
    }
  }

  const session = await createLoginSession(user, fcmToken);

  return {
    ...session,
    user: {
      ...session.user,
      email: user.email,
      hasPassword: Boolean(user.password),
      // Apple sign-up is finished only once a phone number is verified
      needsPhone: !user.phone,
      hasReferral: Boolean(user.referredInfo?.referredId),
    },
    isFirstLogin,
  };
};
