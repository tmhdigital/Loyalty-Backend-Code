import { z, AnyZodObject } from 'zod';
import { USER_ROLES } from '../../../enums/user';



const createVerifyEmailZodSchema = z.object({
  body: z.object({
    email: z
      .string({ required_error: 'Email is required' })
      .email({ message: 'Invalid email address' }),

    oneTimeCode: z
      .number({ required_error: 'One time code is required' }),
  }),
});



const createLoginZodSchema = z.object({
  body: z.object({
    identifier: z
      .string({ required_error: "Email or phone is required" })
      .min(1, "Email or phone is required"),

    password: z
      .string({ required_error: "Password is required" })
      .min(1, "Password is required"),
  }),
});



const createForgetPasswordZodSchema = z.object({
  body: z.object({
    identifier: z
      .string({ required_error: "Phone number or email is required" })
      .refine((val) => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const phoneRegex = /^\+[1-9]\d{6,14}$/;
        return emailRegex.test(val) || phoneRegex.test(val);
      }, {
        message: "Identifier must be a valid email or phone number with country code (+)",
      }),
  }),
});


const passwordRegex =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;


const createResetPasswordZodSchema = z
  .object({
    body: z.object({
      newPassword: z
        .string({ required_error: 'Password is required' })
        .min(8)
        .regex(
          passwordRegex,
          'Password must include uppercase, lowercase, number & special character'
        ),

      confirmPassword: z
        .string({ required_error: 'Confirm Password is required' }),
    }),
  })
  .refine((data) => data.body.newPassword === data.body.confirmPassword, {
    message: "New password and confirm password must match",
    path: ["body", "confirmPassword"],
  }) as unknown as AnyZodObject;



const createChangePasswordZodSchema = z
  .object({
    body: z.object({
      // Required by the service when the account already has a password
      currentPassword: z.string().optional(),

      newPassword: z
        .string({ required_error: 'New Password is required' })
        .min(8)
        .regex(
          passwordRegex,
          'Password must include uppercase, lowercase, number & special character'
        ),

      confirmPassword: z
        .string({ required_error: 'Confirm Password is required' }),
    }),
  })
  .refine((data) => data.body.newPassword === data.body.confirmPassword, {
    message: "New password and confirm password must match",
    path: ["body", "confirmPassword"],
  }) as unknown as AnyZodObject;



const createVerifyOtpZodSchema = z.object({
  body: z.object({
    identifier: z
      .string({ required_error: "Phone number or email is required" })
      .refine((val) => {
        const phoneRegex = /^\+?[0-9]{6,15}$/;
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return phoneRegex.test(val) || emailRegex.test(val);
      }, {
        message: "Identifier must be a valid phone number or email",
      }),

    oneTimeCode: z
      .number({ required_error: "OTP is required" }),
  }),
});



const googleLoginZodSchema = z.object({
  body: z.object({
    idToken: z
      .string({ required_error: 'ID token is required' }),

    // Ignored: Google sign-in is customer-only. Kept so older app builds still validate.
    role: z
      .enum([
        USER_ROLES.MERCHANT,
        USER_ROLES.USER,
      ])
      .optional(),

    fcmToken: z.string().optional(),
  }),
});

const sendPhoneOtpZodSchema = z.object({
  body: z.object({
    phone: z
      .string({ required_error: 'Phone number is required' })
      .regex(/^\+?[0-9]{7,15}$/, 'Invalid phone number'),
  }),
});

const verifyPhoneOtpZodSchema = z.object({
  body: z.object({
    oneTimeCode: z.number({ required_error: 'OTP is required' }),
  }),
});

const applyReferralZodSchema = z.object({
  body: z.object({
    referralId: z
      .string({ required_error: 'Referral ID is required' })
      .min(1, 'Referral ID is required'),
  }),
});


export const AuthValidation = {
  createVerifyEmailZodSchema,
  createForgetPasswordZodSchema,
  createLoginZodSchema,
  createResetPasswordZodSchema,
  createChangePasswordZodSchema,
  createVerifyOtpZodSchema,
  googleLoginZodSchema,
  sendPhoneOtpZodSchema,
  verifyPhoneOtpZodSchema,
  applyReferralZodSchema,
};