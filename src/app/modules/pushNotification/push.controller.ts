import { Request, Response } from "express";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { PushService } from "./push.service";

import { StatusCodes } from "http-status-codes";



const sendNotificationToAll = catchAsync(async (req, res) => {

  const data = await PushService.sendNotificationToAllUsers(
    req.body,
    (req.user as any)?._id
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Notification sent successfully",
    data: data,
  });
});



const sendMerchantPromotion = catchAsync(async (req: Request, res: Response) => {
  const merchant = req.user as any;
  const merchantId = merchant._id;


  // 🔹 Media base URL (Spaces CDN — same as frontend's VITE_MEDIA_URL)
  const mediaBaseUrl = process.env.MEDIA_URL as string;

  // Parse JSON data
  const payloadData = req.body.data ? JSON.parse(req.body.data) : {};

  // Image: uploaded file overrides body link
  const image =
    req.files && (req.files as any).image
      ? `${mediaBaseUrl}${(req.files as any).image[0].path}`
      : payloadData.image?.startsWith("http")
        ? payloadData.image
        : payloadData.image
          ? `${mediaBaseUrl}${payloadData.image}`
          : undefined;


  // FRONTEND LAT/LNG
  let merchantLocation = null;
  if (payloadData.lat !== undefined && payloadData.lng !== undefined) {
    merchantLocation = {
      type: "Point",
      coordinates: [Number(payloadData.lng), Number(payloadData.lat)],
    };

  }

  const payload = {
    title: payloadData.title || "Promotion",
    message: payloadData.message,
    image,
    target: { type: "points" },
    filters: {
      minPoints: payloadData.minPoints ? Number(payloadData.minPoints) : 0,
      segment: payloadData.segment ?? "all_customer",
      radius: payloadData.radius ? Number(payloadData.radius) : Infinity,
      merchantLocation,
    },
    state: payloadData.state,
    country: payloadData.country,
    city: payloadData.city,
    tier: payloadData.tier,
    subscriptionType: payloadData.subscriptionType,
  };



  const data = await PushService.sendMerchantPromotion(payload, merchantId);



  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Promotion notification sent successfully",
    data: data,
  });
});




export const PushController = {
  sendNotificationToAll,
  sendMerchantPromotion
  //  getAllPushes 
};
