import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";

import { PromotionAdminService } from "./adminPromotion.service";
import catchAsync from "../../../../shared/catchAsync";
import ApiError from "../../../../errors/ApiErrors";
import sendResponse from "../../../../shared/sendResponse";
import { IPromotion } from "./adminPromotion.interface";
import { JwtPayload } from "jsonwebtoken";


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
  } = bodyData;

  if (!name || !customerSegment || !promotionType) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Required fields missing");
  }

  // IMAGE URL
  let imageUrl: string | undefined = undefined;
  if (req.files && (req.files as any).image && (req.files as any).image[0]) {
    const file = (req.files as any).image[0];
    imageUrl = file.path;
  }

  // MERCHANT ID from request.user (auth middleware sets req.user)
  const merchantId = (req.user as any)?._id;
  const createdBy = (req.user as any)?._id;

  if (!merchantId) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, "Merchant ID not found");
  }

  if (!createdBy) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, "Creator ID not found");
  }

  const payload: Partial<IPromotion> = {
    name,
    discountPercentage: Number(discountPercentage),
    promotionType,
    customerSegment,
    startDate: normalizeStartDate(startDate),
    availableDays,
    endDate: normalizeEndDate(endDate),
    image: imageUrl,
    createdBy,
  };

  const data = await PromotionAdminService.createPromotionToDB(payload);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Promotion created successfully",
    data: data,
  });
});

const getAllPromotions = catchAsync(async (req: Request, res: Response) => {
  const data = await PromotionAdminService.getAllPromotionsFromDB(req.query);
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
    const data = await PromotionAdminService.getAllPromotionsOfAMerchant(
      user._id,
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

const getPromotionsForUser = catchAsync(async (req: Request, res: Response) => {
  const userId = (req.user as any)?._id;
  if (!userId) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, "User ID not found");
  }

  const data = await PromotionAdminService.getPromotionsForUserFromDB(userId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Promotions retrieved successfully for user",
    data: data,
  });
});


const getSinglePromotion = catchAsync(async (req: Request, res: Response) => {
  const data = await PromotionAdminService.getSinglePromotionFromDB(req.params.id);
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
    ...(bodyData.startDate && { startDate: normalizeStartDate(bodyData.startDate) }),
    ...(bodyData.endDate && { endDate: normalizeEndDate(bodyData.endDate) }),
    ...(bodyData.availableDays && {
      availableDays: Array.isArray(bodyData.availableDays)
        ? bodyData.availableDays
        : [bodyData.availableDays],
    }),
  };

  // ✅ Fix Image URL Format (same as create)
  if (req.files && (req.files as any).image && (req.files as any).image[0]) {
    const file = (req.files as any).image[0];
    payload.image = file.path;
  }

  const data = await PromotionAdminService.updatePromotionToDB(
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
  const data = await PromotionAdminService.deletePromotionFromDB(req.params.id);
  if (!data) throw new ApiError(StatusCodes.NOT_FOUND, "Promotion not found");

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Promotion deleted successfully",
    data: data,
  });
});

const togglePromotion = catchAsync(async (req: Request, res: Response) => {
  const data = await PromotionAdminService.togglePromotionInDB(req.params.id);
  if (!data) throw new ApiError(StatusCodes.NOT_FOUND, "Promotion not found");

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: `Promotion toggled successfully`,
    data: data,
  });
});

const getPopularMerchants = catchAsync(async (req: Request, res: Response) => {
  const data = await PromotionAdminService.getPopularMerchantsFromDB();

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Popular merchants fetched successfully",
    data: data,
  });
});
const getDetailsOfMerchant = catchAsync(async (req: Request, res: Response) => {
  const data = await PromotionAdminService.getDetailsOfMerchant(req.params.id);

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
    const data = await PromotionAdminService.getUserTierOfMerchant(
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

const getPromotionsByUserCategory = catchAsync(
  async (req: Request, res: Response) => {
    const { categoryName } = req.query; // user sends ?categoryName=restaurant

    const data = await PromotionAdminService.getPromotionsByUserCategory(
      String(categoryName)
    );

    res.status(200).json({
      success: true,
      message: "Promotions fetched successfully",
      data: data,
    });
  }
);

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

  getPromotionsForUser,

  getAllPromotionsOfAMerchant,

};
