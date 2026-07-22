



import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { AuthService } from './auth.service';
import ApiError from '../../../errors/ApiErrors';
import { jwtHelper } from '../../../helpers/jwtHelper';
import config from '../../../config';
import { Secret } from 'jsonwebtoken';

/* ----------------------------------------
   COOKIE NAMES (CENTRALIZED)
---------------------------------------- */
const REFRESH_COOKIE = 'refreshToken';
const REFRESH_COOKIE_ADMIN = 'refreshToken_admin';
const REFRESH_COOKIE_BUSINESS = 'refreshToken_business';

/* ----------------------------------------
   COOKIE OPTIONS (PRODUCTION SAFE)
---------------------------------------- */
// const refreshCookieOptions = {
//   httpOnly: true,
//   secure: config.node_env === 'development',
//   sameSite: (config.node_env === 'development' ? 'lax' : 'none') as 'none' | 'lax',
//   path: '/',
//   maxAge: 30 * 24 * 60 * 60 * 1000,
// };


// auth.controller.ts
const refreshCookieOptions = {
  httpOnly: true,
  secure: false,  
  sameSite: 'lax' as 'lax',  
  path: '/',
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

/* ----------------------------------------
   COOKIE NAME RESOLVER
---------------------------------------- */
const getRefreshCookieName = (device?: string) => {
  if (!device) return REFRESH_COOKIE;

  const d = String(device).trim().toLowerCase();

  if (d === 'admin') return REFRESH_COOKIE_ADMIN;
  if (d === 'business' || d === 'merchant' || d === 'company')
    return REFRESH_COOKIE_BUSINESS;

  return `${REFRESH_COOKIE}_${d}`;
};

/* ----------------------------------------
   VERIFY EMAIL
---------------------------------------- */
const verifyEmail = catchAsync(async (req: Request, res: Response) => {
  const data = await AuthService.verifyEmailToDB(req.body);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: data.message,
    data,
  });
});

/* ----------------------------------------
   VERIFY OTP
---------------------------------------- */
const verifyOtp = catchAsync(async (req: Request, res: Response) => {
  const data = await AuthService.verifyOtpToDB(req.body);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: data.message,
    data: {
      accessToken: data.accessToken,
      resetToken: data.resetToken,
    },
  });
});

/* ----------------------------------------
   LOGIN USER (FIXED COOKIE HANDLING)
---------------------------------------- */
const loginUser = catchAsync(async (req: Request, res: Response) => {
  const data = await AuthService.loginUserFromDB(req.body);

  const cookieName = getRefreshCookieName(req.body.device);

  res.cookie(cookieName, data.refreshToken, refreshCookieOptions);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'User login successfully',
    data: {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      user: data.user,
    },
  });
});

/* ----------------------------------------
   FORGOT PASSWORD
---------------------------------------- */
const forgetPassword = catchAsync(async (req: Request, res: Response) => {
  const { identifier } = req.body;

  const data = await AuthService.forgetPasswordToDB(identifier);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Please check your phone or email, we sent an OTP!',
    data,
  });
});

/* ----------------------------------------
   RESET PASSWORD
---------------------------------------- */
const resetPassword = catchAsync(async (req: Request, res: Response) => {
  const token = req.headers.authorization;

  const data = await AuthService.resetPasswordToDB(token!, req.body);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Password reset successfully',
    data,
  });
});

/* ----------------------------------------
   CHANGE PASSWORD
---------------------------------------- */
const changePassword = catchAsync(async (req: Request, res: Response) => {
  const user = req.user;

  if (!user) throw new ApiError(StatusCodes.UNAUTHORIZED, 'User not authenticated');

  await AuthService.changePasswordToDB(user, req.body);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Password changed successfully',
  });
});

/* ----------------------------------------
   NEW ACCESS TOKEN (FIXED COOKIE READ)
---------------------------------------- */
const newAccessToken = catchAsync(async (req: Request, res: Response) => {
  const device = req.body.device;


  if (!device) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Device type is required');
  }

  const refreshToken =
    req.cookies?.[getRefreshCookieName(device)] ||
    req.body.refreshToken;

  if (!refreshToken) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Refresh token not found');
  }

  const data = await AuthService.newAccessTokenToUser(refreshToken);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Generate Access Token successfully',
    data,
  });
});

/* ----------------------------------------
   DELETE USER
---------------------------------------- */
const deleteUser = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(StatusCodes.UNAUTHORIZED, 'User not authenticated');

  const data = await AuthService.deleteUserFromDB(req.user, req.body.password);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Account Deleted successfully',
    data,
  });
});

/* ----------------------------------------
   DELETE OWN USER
---------------------------------------- */
const deleteOwnUser = catchAsync(async (req: Request, res: Response) => {
  const userId = (req.user as any)?._id;

  if (!userId) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'User ID missing in request token');
  }

  const { password } = req.body;

  if (!password) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Password is required');
  }

  const data = await AuthService.deleteOwnUserAccount(userId, password);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'User account deleted successfully',
    data,
  });
});

/* ----------------------------------------
   RESEND OTP
---------------------------------------- */
const resendOtp = catchAsync(async (req: Request, res: Response) => {
  const { identifier } = req.body;

  if (!identifier) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Email or phone is required');
  }

  const data = await AuthService.resendOtpToDB(identifier);

  res.status(StatusCodes.OK).json({
    success: true,
    message: `OTP resent successfully via ${data.via}`,
    data,
  });
});


/* ----------------------------------------
   LOGOUT USER
---------------------------------------- */

const logoutUser = catchAsync(async (req: Request, res: Response) => {
  const device = req.body.device;

  const cookieName = getRefreshCookieName(device);

  res.clearCookie(cookieName, {
    httpOnly: true,
    secure: false,     
    sameSite: 'lax',   
    path: '/',
  });


  const userId = (req.user as any)?._id;
  if (!userId) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'User not authenticated');
  }

  await AuthService.logoutUserFromDB(userId);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Logout successful",
  });
});
/* ----------------------------------------
   UPLOAD DOCUMENT IMAGES
---------------------------------------- */
const uploadDocumentImages = async (req: Request, res: Response) => {
  const userId = (req.user as any)?._id;

  if (!userId) throw new ApiError(400, 'User ID is required');

  const files = req.files as { [fieldname: string]: Express.Multer.File[] };

  if (!files?.image) {
    throw new ApiError(400, 'No images uploaded');
  }

  const data = await AuthService.uploadDocumentImagesToDB(userId, files.image);

  res.status(200).json({
    success: true,
    message: 'Images uploaded successfully',
    data,
  });
};

/* ----------------------------------------
   ARCHIVE USER
---------------------------------------- */
const archiveUser = catchAsync(async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Authorization token is required');
  }

  const token = authHeader.split(' ')[1];

  const decoded = jwtHelper.verifyToken(token, config.jwt.jwt_secret as Secret);

  const userId = (decoded as any)?.id;

  if (!userId) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Invalid token');
  }

  const data = await AuthService.archiveUserInDB(userId);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'User archived successfully',
    data,
  });
});

/* ----------------------------------------
   GOOGLE LOGIN
---------------------------------------- */
const googleLogin = catchAsync(async (req: Request, res: Response) => {
  const { idToken, role } = req.body;

  const data = await AuthService.googleLoginToDB(idToken, role);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'User login successfully',
    data,
  });
});

/* ----------------------------------------
   EXPORT
---------------------------------------- */
export const AuthController = {
  verifyEmail,
  loginUser,
  forgetPassword,
  resetPassword,
  changePassword,
  newAccessToken,
  deleteUser,
  deleteOwnUser,
  resendOtp,
  verifyOtp,
  uploadDocumentImages,
  archiveUser,
  googleLogin,
  logoutUser,
};