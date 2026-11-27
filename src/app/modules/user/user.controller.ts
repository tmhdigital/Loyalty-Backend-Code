import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { UserService } from "./user.service";
import { CreateUserPayload } from "./user.interface";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import ApiError from "../../../errors/ApiErrors";
import { JwtPayload } from "jsonwebtoken";
import { getSingleFileUrl } from "../../../shared/getFilePath";
import {
  applyWebsiteToPayload,
  WEBSITE_URL_MESSAGES,
} from "../../../utils/websiteUrl";
import { USER_ROLES } from "../../../enums/user";

// SECURITY: signup par sirf yeh fields. Pehle poori body save hoti thi, is
// liye koi bhi `verified: true`, `status`, `points` waghera bhej sakta tha.
const SIGNUP_FIELDS = [
  "firstName",
  "lastName",
  "phone",
  "email",
  "password",
  "role", // Zod sirf MERCHANT / USER allow karta hai
  "country",
  "city",
  "referredId",
] as const;

// SECURITY: user apne profile mein sirf yeh fields badal sakta hai.
// role, status, verified, approveStatus, subscription, paymentStatus,
// isDeleted, points, email, referenceId waghera yahan se nahi badal sakte.
const PROFILE_UPDATABLE_FIELDS = [
  "firstName",
  "lastName",
  "businessName",
  "website",
  "address",
  "service",
  "country",
  "city",
  "about",
  "gender",
  "latitude",
  "longitude",
  "location",
  "fcmToken",
  "appId",
  "notificationSettings",
  "preferences",
] as const;

const NOTIFICATION_SETTING_KEYS = [
  "promotionalEmails",
  "appNotifications",
  "smsNotifications",
  "referralNotifications",
  "subscriptionNotifications",
  "pushNotifications",
];

const pickFields = (
  source: Record<string, any> | undefined,
  fields: readonly string[]
): Record<string, any> => {
  const picked: Record<string, any> = {};
  if (!source || typeof source !== "object") return picked;
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(source, field)) {
      picked[field] = source[field];
    }
  }
  return picked;
};

// register user
const createUser = catchAsync(
  async (req: Request, res: Response) => {
    // Body is already checked by createUserZodSchema in the route; pickFields
    // only drops keys that are not allowed at signup.
    const userData = pickFields(req.body, SIGNUP_FIELDS) as CreateUserPayload;

    const data = await UserService.createUserToDB(userData);

    const destination = data.email ? "email" : data.phone ? "phone" : "email or phone";

    sendResponse(res, {
      success: true,
      statusCode: StatusCodes.OK,
      message: `Enter the verification code sent to your ${destination}. Please verify before login.`,
    });
  }
);

// retrieved user profile
const getUserProfile = catchAsync(async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, "User not logged in");
  }

  const data = await UserService.getUserProfileFromDB(user);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Profile data retrieved successfully",
    data: data,
  });
});

//update profile
const updateProfile = catchAsync(
  async (req: Request, res: Response) => {
    const user = req.user;

    let rawBody = req.body;
    if (typeof req.body.data === "string") {
      rawBody = JSON.parse(req.body.data);
    }

      if (rawBody.phone) {
      return sendResponse(res, {
        success: false,
        statusCode: 400,
        message: "Phone number cannot be changed",
      });
    }

    // SECURITY: sirf yehi fields user khud badal sakta hai. Pehle poori body
    // DB mein jaati thi, jis se koi bhi apna role / status / verified badal
    // sakta tha (aur `data` JSON string ke zariye Zod check bhi skip hota tha).
    const bodyData = pickFields(rawBody, PROFILE_UPDATABLE_FIELDS);

    // Website / social link: format theek karo, ghalat ho to 400.
    // Yahan isliye ke body kabhi `data` JSON string mein aati hai aur
    // validateRequest parsed value wapas req.body mein nahi likhta.
    applyWebsiteToPayload(bodyData);

    // Merchant ka profile/shop form (businessName ke saath) bina website ke
    // save nahi hota. FCM token, location jaise chhote updates par lagu nahi.
    if (
      (user as JwtPayload)?.role === USER_ROLES.MERCHANT &&
      bodyData.businessName !== undefined &&
      bodyData.website === undefined
    ) {
      throw new ApiError(StatusCodes.BAD_REQUEST, WEBSITE_URL_MESSAGES.required);
    }
    // FIX: multer ab memoryStorage par hai, `filename` undefined hota tha
    // aur DB mein "/images/undefined" save ho raha tha. Ab middleware ka
    // set kiya hua poora CDN URL use hota hai.
    const profile = getSingleFileUrl(req.files, "profile");
    const photo = getSingleFileUrl(req.files, "coverPhoto");

    if (bodyData?.latitude && bodyData?.longitude) {
      bodyData.location = {
        type: "Point",
        coordinates: [Number(bodyData.longitude), Number(bodyData.latitude)],
      };
      delete bodyData.latitude;
      delete bodyData.longitude;
    }


    /** 🔔 Notification settings safe update (sirf maloom keys) */
    const notificationUpdate: Record<string, boolean> = {};
    if (bodyData.notificationSettings && typeof bodyData.notificationSettings === "object") {
      for (const [key, value] of Object.entries(bodyData.notificationSettings)) {
        if (!NOTIFICATION_SETTING_KEYS.includes(key)) continue;
        notificationUpdate[`notificationSettings.${key}`] =
          typeof value === "string" ? value.toLowerCase() === "true" : Boolean(value);
      }
    }
    delete bodyData.notificationSettings;

    const profileData = {
      profile,
      photo,

      ...bodyData,
      ...notificationUpdate,
    };


    const data = await UserService.updateProfileToDB(
      user as JwtPayload,
      profileData
    );




    sendResponse(res, {
      success: true,
      statusCode: StatusCodes.OK,
      message: "Profile updated successfully",
      data: data,
    });
  }
);

const getUserOnlineStatus = catchAsync(async (req: Request, res: Response) => {
  const userId = req.params.id;

  const data = await UserService.getUserOnlineStatusFromDB(userId);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "User online status fetched successfully",
    data: data,
  });
});

const getUserSummaryCounts = catchAsync(async (req: Request, res: Response) => {
  const userId = (req.user as any)?._id;

  if (!userId) {
    return res.status(StatusCodes.UNAUTHORIZED).json({
      success: false,
      message: "User not logged in",
    });
  }

  const data = await UserService.getUserSummaryCountsFromDB(userId);

  // 6️⃣ Response
  return res.status(StatusCodes.OK).json({
    success: true,
    message: "User Summary fetched successfully",
    data,
  });
});


export const UserController = {
  createUser,
  getUserProfile,
  updateProfile,
  getUserOnlineStatus,
  getUserSummaryCounts
};