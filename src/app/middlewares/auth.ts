import { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { Secret, JwtPayload } from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import * as crypto from 'crypto';

import config from '../../config';
import { jwtHelper } from '../../helpers/jwtHelper';
import ApiError from '../../errors/ApiErrors';
import { User } from '../modules/user/user.model';

const auth =
  (...roles: string[]) =>
    async (
      req: Request,
      res: Response,
      next: NextFunction
    ) => {
      try {
        const authHeader = req.headers.authorization;

        // ✅ Authorization check
        if (!authHeader) {
          throw new ApiError(
            StatusCodes.UNAUTHORIZED,
            'Authorization header missing'
          );
        }

        // ✅ Strict Bearer check
        if (!authHeader.startsWith('Bearer ')) {
          throw new ApiError(
            StatusCodes.UNAUTHORIZED,
            'Invalid authorization format. Use Bearer token'
          );
        }

        // ✅ Extract token
        const token = authHeader.slice(7).trim();

        if (!token) {
          throw new ApiError(
            StatusCodes.UNAUTHORIZED,
            'Token missing'
          );
        }

        // ✅ Verify JWT
        const verifyUser = jwtHelper.verifyToken(
          token,
          config.jwt.jwt_secret as Secret
        ) as JwtPayload & {
          id: string;
          sessionId: string;
        };

        // ✅ Payload validation
        if (!verifyUser?.id) {
          throw new ApiError(
            StatusCodes.UNAUTHORIZED,
            'Invalid token payload'
          );
        }

        // ✅ Find user
        const user = await User.findById(verifyUser.id)
          .select(
            '_id role email sessionId isSubMerchant merchantId isDeleted status'
          )
          .lean();

        if (!user) {
          throw new ApiError(
            StatusCodes.UNAUTHORIZED,
            'User not found'
          );
        }

        // ✅ Deleted user check
        if (user.isDeleted) {
          throw new ApiError(
            StatusCodes.FORBIDDEN,
            'Account deleted'
          );
        }

        // ✅ Session validation
        const hashedIncoming = crypto
          .createHash("sha256")
          .update(verifyUser.sessionId)
          .digest("hex");

        const isSessionValid = user.sessionId &&
          (user.sessionId.startsWith('$2')
            ? await bcrypt.compare(verifyUser.sessionId, user.sessionId)  // purane bcrypt sessions ke liye
            : user.sessionId === hashedIncoming);                          // naye SHA-256 sessions

        if (!isSessionValid) {
          throw new ApiError(
            StatusCodes.UNAUTHORIZED,
            'You are logged in from another device'
          );
        }

        // ✅ Attach user to request
        req.user = {
          _id: user._id,
          role: user.role,
          email: user.email,
          isSubMerchant: user.isSubMerchant,
          merchantId: user.merchantId,
        };

        // ✅ Role validation
        if (
          roles.length &&
          !roles.includes(user.role as string)
        ) {
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