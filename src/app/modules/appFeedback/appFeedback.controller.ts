import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import ApiError from "../../../errors/ApiErrors";
import { AppFeedbackService } from "./appFeedback.service";

const createFeedback = catchAsync(async (req: Request, res: Response) => {
  const userId = (req.user as any)?._id?.toString();
  if (!userId) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, "User not found");
  }

  const { rating, category, comment, appVersion, platform, deviceModel } =
    req.body;
  const data = await AppFeedbackService.createFeedback(userId, {
    rating,
    category,
    comment,
    appVersion,
    platform,
    deviceModel,
  });

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Thank you! Your feedback has been submitted",
    data: { _id: data._id },
  });
});

const getAllFeedback = catchAsync(async (req: Request, res: Response) => {
  const result = await AppFeedbackService.getAllFeedback(req.query);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "App feedback fetched successfully",
    data: result.data,
    pagination: result.pagination,
  });
});

const updateFeedback = catchAsync(async (req: Request, res: Response) => {
  const { status, adminNote } = req.body;
  const data = await AppFeedbackService.updateFeedback(req.params.id, {
    ...(status !== undefined && { status }),
    ...(adminNote !== undefined && { adminNote }),
  });

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Feedback updated successfully",
    data,
  });
});

export const AppFeedbackController = {
  createFeedback,
  getAllFeedback,
  updateFeedback,
};
