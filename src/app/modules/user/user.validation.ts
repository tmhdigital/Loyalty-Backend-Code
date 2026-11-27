import { z } from "zod";
import { USER_ROLES } from "../../../enums/user";

const createUserZodSchema = z.object({
  body: z.object({
    firstName: z.string({
      required_error: "First name is required",
    }),

    country: z
      .string({
        required_error: "Country is required",
      })
      .optional(),

    phone: z
      .string({
        required_error: "Phone number is required",
      })
      .min(7, "Phone number must be at least 7 characters")
      .max(15, "Phone number must be at most 15 characters"),

    email: z
      .string({
        required_error: "Email is required",
      })
      .email({
        message: "Invalid email address",
      }),

    password: z
      .string({
        required_error: "Password is required",
      })
      .min(8, "Password must be at least 8 characters")
      .regex(
        /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])/,
        "Password must contain at least one letter, one number, and one special character"
      ),

    role: z.enum([
      USER_ROLES.MERCHANT,
      USER_ROLES.USER,
    ]),
  }),
});

const updateUserZodSchema = z.object({
  body: z.object({
    firstName: z.string().optional(),

    lastName: z.string().optional(),

    appId: z.string().optional(),

    fcmToken: z.string().optional(),

    // `role` yahan jaan boojh kar nahi hai: profile update se role kabhi nahi
    // badalta (controller ka whitelist bhi isay hata deta hai).

    email: z
      .string()
      .email({
        message: "Invalid email address",
      })
      .optional(),

    password: z
      .string()
      .min(6, "Password must be at least 6 characters")
      .regex(
        /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])/,
        "Password must contain at least one letter, one number, and one special character"
      )
      .optional(),


    profile: z.string().url().optional(),

    documentVerified: z.array(z.string()).optional(),

    photo: z.string().optional(),

    about: z
      .string({
        required_error: "About Us is required",
      })
      .max(200, "About Us must not exceed 200 characters")
      .optional(),

    emailVerified: z.boolean().optional(),

    phoneVerified: z.boolean().optional(),

    verified: z.boolean().optional(),

    accountInformation: z
      .object({
        status: z.boolean().optional(),

        stripeAccountId: z.string().optional(),

        externalAccountId: z.string().optional(),

        currency: z.string().optional(),
      })
      .optional(),

    pages: z.array(z.string()).optional(),

 


 









    zodiacPreference: z.string().optional(),
  }),
});

export const UserValidation = {
  createUserZodSchema,
  updateUserZodSchema,
};