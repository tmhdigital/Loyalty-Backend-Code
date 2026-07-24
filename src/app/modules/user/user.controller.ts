import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { UserService } from "./user.service";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import ApiError from "../../../errors/ApiErrors";
import { JwtPayload } from "jsonwebtoken";

// register user
const createUser = catchAsync(
  async (req: Request, res: Response) => {
    const userData = {
      ...req.body,
      //   gender: req.body.gender || "Unknown",
    };

    const data = await UserService.createUserToDB(userData);

    const destination = data.email ? "email" : data.phone ? "phone" : "email or phone";

    sendResponse(res, {
      success: true,
      statusCode: StatusCodes.OK,
      message: `Enter the verification code sent to your ${destination}. Please verify before login.`,
    });
  }
);

// register admin
const createAdmin = catchAsync(
  async (req: Request, res: Response) => {
    const { ...userData } = req.body;
    const data = await UserService.createAdminToDB(userData);

    sendResponse(res, {
      success: true,
      statusCode: StatusCodes.OK,
      message: "Admin created successfully",
      data: data,
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

    let bodyData = req.body;
    if (typeof req.body.data === "string") {
      bodyData = JSON.parse(req.body.data);
    }

      if (bodyData.phone) {
      return sendResponse(res, {
        success: false,
        statusCode: 400,
        message: "Phone number cannot be changed",
      });
    }
    let profile;
    if (req.files && "profile" in req.files && req.files.profile[0]) {
      profile = req.files.profile[0].path;
    }
    let photo;
    if (req.files && "coverPhoto" in req.files && req.files.coverPhoto[0]) {
      photo = req.files.coverPhoto[0].path;
    }

    if (bodyData?.latitude && bodyData?.longitude) {
      bodyData.location = {
        type: "Point",
        coordinates: [Number(bodyData.longitude), Number(bodyData.latitude)],
      };
      delete bodyData.latitude;
      delete bodyData.longitude;
    }


      /** 🔔 Notification settings safe update */
  const notificationUpdate: Record<string, boolean> = {};

    if (bodyData.notificationSettings) {
      // Loop through notificationSettings
      for (const [key, value] of Object.entries(bodyData.notificationSettings)) {
       
        if (typeof value === "string") {
          notificationUpdate[`notificationSettings.${key}`] = value.toLowerCase() === "true";
        } else {
       
          notificationUpdate[`notificationSettings.${key}`] = value as boolean;
        }
      }

  
  delete bodyData.notificationSettings;
}

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
  createAdmin,
  getUserProfile,
  updateProfile,
  getUserOnlineStatus,
  getUserSummaryCounts

};
