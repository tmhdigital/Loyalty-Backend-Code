import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";

import { PromotionService } from "./promotionMerchant.service";
import catchAsync from "../../../../shared/catchAsync";
import ApiError from "../../../../errors/ApiErrors";
import sendResponse from "../../../../shared/sendResponse";
import { IPromotion } from "./promotionMerchant.interface";
import { JwtPayload } from "jsonwebtoken";
import { sendNotification } from "../../../../helpers/notificationsHelper";
import { NotificationType } from "../../notification/notification.model";
import { getSingleFileUrl } from "../../../../shared/getFilePath";


const normalizeStartDate = (date: string) => {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0); // start of day UTC
  return d;
};

const normalizeEndDate = (date: string) => {
  const d = new Date(date);
  d.setUTCHours(23, 59, 59, 999); // end of day UTC
  return d;
};


const createPromotion = catchAsync(async (req: Request, res: Response) => {


  // body data parse
  const bodyData = req.body.data ? JSON.parse(req.body.data) : {};


  const {
    name,
    discountPercentage,
    promotionType,
    customerSegment,
    startDate,
    availableDays,
    endDate,
    grossValue,
  } = bodyData;



  if (!name || !customerSegment || !promotionType || !grossValue) {

    throw new ApiError(StatusCodes.BAD_REQUEST, "Required fields missing");
  }

  // IMAGE URL
  let imageUrl: string | undefined = undefined;

  // FIX: `file.filename` memoryStorage ke sath undefined hota hai.
  // Middleware ne Spaces par upload karke poora URL `file.path` mein rakha hai.
  imageUrl = getSingleFileUrl(req.files, "image");

  // USER from auth middleware
  const user = req.user as any;


  const merchantId = user.isSubMerchant
    ? user.merchantId
    : user._id;



  if (!merchantId) {

    throw new ApiError(StatusCodes.UNAUTHORIZED, "Merchant ID not found");
  }

  const payload: Partial<IPromotion> = {
    name,
    discountPercentage: Number(discountPercentage),
    promotionType,
    customerSegment,
    startDate: normalizeStartDate(startDate),
    endDate: normalizeEndDate(endDate),
    availableDays,
    image: imageUrl,
    merchantId,
    grossValue: Number(grossValue),
  };



  const data = await PromotionService.createPromotionToDB(payload);



  if (data) {


    await sendNotification({
      userIds: [merchantId],
      title: "Congratulations! promotion published",
      body: `Your promotion "${name}" has been published successfully`,
      type: NotificationType.PROMOTION,
    });

  
  }

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Promotion created successfully",
    data: data,
  });


});



const getAllPromotions = catchAsync(async (req: Request, res: Response) => {
  const data = await PromotionService.getAllPromotionsFromDB(req.query);
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Promotions retrieved successfully",
    data: data.promotions,
    pagination: data.pagination,
  });
});


const getAllPromotionsOfAMerchant = catchAsync(
  async (req: Request, res: Response) => {
    const user = req.user as JwtPayload;
    const filterId = user.isSubMerchant ? user.merchantId : user._id;
    const data = await PromotionService.getAllPromotionsOfAMerchant(
      filterId,
      req.query
    );
    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: "Promotions retrieved successfully",
      data: data.promotions,
      pagination: data.pagination,
    });
  }
);



const getSinglePromotion = catchAsync(async (req: Request, res: Response) => {
  const data = await PromotionService.getSinglePromotionFromDB(req.params.id);
  if (!data) throw new ApiError(StatusCodes.NOT_FOUND, "Promotion not found");

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Promotion retrieved successfully",
    data: data,
  });
});

const updatePromotion = catchAsync(async (req: Request, res: Response) => {
  const bodyData = req.body.data ? JSON.parse(req.body.data) : { ...req.body };

  const payload: Partial<any> = {
    ...(bodyData.name && { name: bodyData.name }),
    ...(bodyData.discountPercentage && {
      discountPercentage: Number(bodyData.discountPercentage),
    }),
    ...(bodyData.promotionType && { promotionType: bodyData.promotionType }),
    ...(bodyData.customerSegment && {
      customerSegment: bodyData.customerSegment,
    }),
     // 🔥 FIXED START DATE
    ...(bodyData.startDate && {
      startDate: normalizeStartDate(bodyData.startDate),
    }),

    // 🔥 FIXED END DATE
    ...(bodyData.endDate && {
      endDate: normalizeEndDate(bodyData.endDate),
    }),
    ...(bodyData.availableDays && {
      availableDays: Array.isArray(bodyData.availableDays)
        ? bodyData.availableDays
        : [bodyData.availableDays],
    }),
    ...(bodyData.grossValue && { grossValue: Number(bodyData.grossValue) }),
  };

  // FIX: Spaces ka poora URL use karo, filename ab set nahi hota
  const updatedImageUrl = getSingleFileUrl(req.files, "image");
  if (updatedImageUrl) {
    payload.image = updatedImageUrl;
  }

  const data = await PromotionService.updatePromotionToDB(
    req.params.id,
    payload
  );

  if (!data) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Promotion not found");
  }

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Promotion updated successfully",
    data: data,
  });
});

const deletePromotion = catchAsync(async (req: Request, res: Response) => {
  const data = await PromotionService.deletePromotionFromDB(req.params.id);
  if (!data) throw new ApiError(StatusCodes.NOT_FOUND, "Promotion not found");

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Promotion deleted successfully",
    data: data,
  });
});

const togglePromotion = catchAsync(async (req: Request, res: Response) => {
  const data = await PromotionService.togglePromotionInDB(req.params.id);
  if (!data) throw new ApiError(StatusCodes.NOT_FOUND, "Promotion not found");

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: `Promotion toggled successfully`,
    data: data,
  });
});

const getPopularMerchants = catchAsync(async (req: Request, res: Response) => {
  const data = await PromotionService.getPopularMerchantsFromDB();

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Popular merchants fetched successfully",
    data: data,
  });
});



const getDetailsOfMerchant = catchAsync(async (req: Request, res: Response) => {
  const userId = (req.user as any)?._id; // logged-in user id, optional
  const data = await PromotionService.getDetailsOfMerchant(req.params.id, userId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Merchants details fetched successfully",
    data: data,
  });
});




const getUserTierOfMerchant = catchAsync(
  async (req: Request, res: Response) => {
    const user = req.user as JwtPayload;
    const data = await PromotionService.getUserTierOfMerchant(
      user._id,
      req.body.merchantId
    );

    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: "User Tier of Merchant fetched successfully",
      data: data,
    });
  }
);

//catagory show pro

const getPromotionsByUserCategory = catchAsync(async (req: Request, res: Response) => {
  const { categoryName } = req.query;
  const userId = (req.user as any)?._id; // logged-in user

  const data = await PromotionService.getPromotionsByUserCategory(
    String(categoryName),
    userId
  );

  res.status(200).json({
    success: true,
    message: "Promotions fetched successfully",
    data: data,
  });
});


const sendNotificationToCustomer = catchAsync(async (req: Request, res: Response) => {
  // FIX: Spaces ka poora URL use karo
  const attachment = getSingleFileUrl(req.files, "image");

  const notificationData = {
    ...req.body,
    attachment,
  };
  const merchant = req.user as JwtPayload;
  const data = await PromotionService.sendNotificationToCustomer(notificationData, merchant._id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Promotion Notification sent successfully",
    data: data,
  });
});


const getCombinePromotionsForUser = catchAsync(async (req: Request, res: Response) => {
  const userId = (req.user as any)?._id;
  if (!userId) throw new ApiError(StatusCodes.UNAUTHORIZED, "User ID not found");

  const data = await PromotionService.getCombinePromotionsForUserFromDB(userId);

  // 1️⃣1️⃣ Send response
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Promotions retrieved successfully for user",
    data: data,
  });
});


export const PromotionController = {
  createPromotion,
  getAllPromotions,
  getSinglePromotion,
  updatePromotion,
  deletePromotion,
  togglePromotion,
  getPopularMerchants,
  getDetailsOfMerchant,
  getUserTierOfMerchant,
  getPromotionsByUserCategory,

  // getPromotionsForUser,
  getCombinePromotionsForUser,

  getAllPromotionsOfAMerchant,
  sendNotificationToCustomer

};