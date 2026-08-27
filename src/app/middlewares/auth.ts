import { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { Secret, JwtPayload } from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import * as crypto from 'crypto';

import config from '../../config';
import { jwtHelper } from '../../helpers/jwtHelper';
import ApiError from '../../errors/ApiErrors';
import { User } from '../modules/user/user.model';
import { cacheGet, cacheSet } from '../../utils/cache.util';


// Cached shape — stable fields only. NOTE: sessionId is intentionally NOT here.
type AuthUserCached = {
  _id: any;
  role: string;
  email: string;
  isSubMerchant: boolean;
  merchantId: any;
  isDeleted: boolean;
  status: string;
};

const AUTH_CACHE_TTL = 30; // seconds
const authCacheKey = (id: string) => `auth:user:${id}`;

const auth =
  (...roles: string[]) =>
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const authHeader = req.headers.authorization;

        if (!authHeader) {
          throw new ApiError(StatusCodes.UNAUTHORIZED, 'Authorization header missing');
        }

        if (!authHeader.startsWith('Bearer ')) {
          throw new ApiError(
            StatusCodes.UNAUTHORIZED,
            'Invalid authorization format. Use Bearer token'
          );
        }

        const token = authHeader.slice(7).trim();
        if (!token) {
          throw new ApiError(StatusCodes.UNAUTHORIZED, 'Token missing');
        }

        const verifyUser = jwtHelper.verifyToken(
          token,
          config.jwt.jwt_secret as Secret
        ) as JwtPayload & { id: string; sessionId: string };

        if (!verifyUser?.id) {
          throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid token payload');
        }

        // ── 1) Stable fields: try cache first, else DB (cache them) ──────
        let cached = await cacheGet<AuthUserCached>(authCacheKey(verifyUser.id));

        if (!cached) {
          const dbUser = await User.findById(verifyUser.id)
            .select('_id role email isSubMerchant merchantId isDeleted status')
            .lean<AuthUserCached>();

          if (!dbUser) {
            throw new ApiError(StatusCodes.UNAUTHORIZED, 'User not found');
          }

          cached = dbUser;
          await cacheSet(authCacheKey(verifyUser.id), cached, AUTH_CACHE_TTL);
        }

        if (cached.isDeleted) {
          throw new ApiError(StatusCodes.FORBIDDEN, 'Account deleted');
        }

      
        const freshUser = await User.findById(verifyUser.id)
          .select('sessionId')
          .lean<{ sessionId: string }>();

        if (!freshUser) {
          throw new ApiError(StatusCodes.UNAUTHORIZED, 'User not found');
        }

        const hashedIncoming = crypto
          .createHash('sha256')
          .update(verifyUser.sessionId)
          .digest('hex');

        const isSessionValid =
          freshUser.sessionId &&
          (freshUser.sessionId.startsWith('$2')
            ? await bcrypt.compare(verifyUser.sessionId, freshUser.sessionId) // legacy bcrypt
            : freshUser.sessionId === hashedIncoming);                        // new SHA-256

        if (!isSessionValid) {
          throw new ApiError(
            StatusCodes.UNAUTHORIZED,
            'You are logged in from another device'
          );
        }

        // ── 3) Attach + role check (unchanged) ───────────────────────────
        req.user = {
          _id: cached._id,
          role: cached.role,
          email: cached.email,
          isSubMerchant: cached.isSubMerchant,
          merchantId: cached.merchantId,
        };

        if (roles.length && !roles.includes(cached.role as string)) {
          throw new ApiError(
            StatusCodes.FORBIDDEN,
            "You don't have permission to access this API"
          );
        }

        next();
      } catch (error) {
        next(error);
      }
    };

export default auth;

