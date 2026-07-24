import { Request, Response } from "express";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { PushService } from "./push.service";

import { StatusCodes } from "http-status-codes";
import { getSingleFileUrl } from "../../../shared/getFilePath";



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


  // 🔹 Base URL
  // NOTE: ab images Spaces CDN par hoti hain, is liye server ka apna
  // baseUrl image URL banane ke liye zaroori nahi raha.
  // const baseUrl = `${req.protocol}s://${req.get("host")}`;
  
  // const baseUrl = "https://hz2w208g-5004.inc1.devtunnels.ms";


  // Parse JSON data
  const payloadData = req.body.data ? JSON.parse(req.body.data) : {};

  // Image: uploaded file overrides body link
  // FIX: uploaded file ab Spaces par jaati hai aur `file.path` mein
  // poora public URL hota hai. Pehle `filename` use ho raha tha jo
  // memoryStorage ke sath undefined rehta hai.
  const image =
    getSingleFileUrl(req.files, "image") ??
    payloadData.image?.replace(/^\/uploads/, "");



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
