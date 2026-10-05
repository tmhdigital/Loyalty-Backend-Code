import express, { NextFunction, Request, Response } from 'express';
import { USER_ROLES } from '../../../enums/user';
import auth from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { AuthController } from './auth.controller';
import { AuthValidation } from './auth.validation';
import fileUploadHandler from '../../middlewares/fileUploaderHandler';

const router = express.Router();

router.post(
    '/login',
    validateRequest(AuthValidation.createLoginZodSchema),
    AuthController.loginUser
);

router.post(
  "/logout",
  auth(),
  AuthController.logoutUser
);

router.post(
    '/forgot-password',
    validateRequest(AuthValidation.createForgetPasswordZodSchema),
    AuthController.forgetPassword
);


router.post(
    '/refresh-token',
    AuthController.newAccessToken
);


router.post(
  '/resend-otp',
  AuthController.resendOtp
);

router.post(
  '/verify-email',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, oneTimeCode } = req.body;
      req.body = { email, oneTimeCode: Number(oneTimeCode) };
      next();
    } catch {
      return res.status(500).json({ message: 'Failed to convert string to number' });
    }
  },
  validateRequest(AuthValidation.createVerifyEmailZodSchema),
  AuthController.verifyEmail
);


router.post(
    '/verify-otp',
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { identifier, oneTimeCode } = req.body;

            req.body = { identifier, oneTimeCode: Number(oneTimeCode) };
            next();
        } catch {
            return res.status(500).json({ message: "Failed to convert string to number" });
        }
    },
    validateRequest(AuthValidation.createVerifyOtpZodSchema),
    AuthController.verifyOtp
);


router.post(
    '/reset-password',
    validateRequest(AuthValidation.createResetPasswordZodSchema),
    AuthController.resetPassword
);

router.post(
    '/change-password',
    auth(),
    validateRequest(AuthValidation.createChangePasswordZodSchema),
    AuthController.changePassword
);


router.post(
    '/upload-documents',
    fileUploadHandler(),
    auth(USER_ROLES.ADMIN, USER_ROLES.USER),
    AuthController.uploadDocumentImages
);

router.put(
    '/archive',
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.USER), // শুধু admin/ super admin করতে পারবে
    AuthController.archiveUser
);



router.delete(
    '/delete-account',
    auth(USER_ROLES.ADMIN),
    AuthController.deleteUser
);
router.delete(
    '/user-delete-account',
    auth(),
    AuthController.deleteOwnUser
);


router.post("/google", validateRequest(AuthValidation.googleLoginZodSchema), AuthController.googleLogin)
router.post("/apple", validateRequest(AuthValidation.appleLoginZodSchema), AuthController.appleLogin)

// Google sign-up steps (logged-in customer)
router.post(
    '/phone/send-otp',
    auth(USER_ROLES.USER),
    validateRequest(AuthValidation.sendPhoneOtpZodSchema),
    AuthController.sendPhoneOtp
);

router.post(
    '/phone/verify',
    auth(USER_ROLES.USER),
    (req: Request, _res: Response, next: NextFunction) => {
        req.body = { oneTimeCode: Number(req.body?.oneTimeCode) };
        next();
    },
    validateRequest(AuthValidation.verifyPhoneOtpZodSchema),
    AuthController.verifyPhoneOtp
);

router.post(
    '/referral/apply',
    auth(USER_ROLES.USER),
    validateRequest(AuthValidation.applyReferralZodSchema),
    AuthController.applyReferral
);

// Code for deleting an account that has no password
router.post(
    '/delete-account/send-otp',
    auth(),
    AuthController.sendDeleteAccountOtp
);

export const AuthRoutes = router;