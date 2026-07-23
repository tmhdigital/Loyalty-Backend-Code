// middlewares/fileUploaderHandler.ts

import { Request } from "express";
import { StatusCodes } from "http-status-codes";
import multer, { FileFilterCallback } from "multer";
import path from "path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import ApiError from "../../errors/ApiErrors";
import config from "../../config";

const s3Client = new S3Client({
  endpoint: config.spaces.endpoint,
  region: "us-east-1", // DO Spaces isay ignore karta hai, SDK ko chahiye hota hai
  credentials: {
    accessKeyId: config.spaces.key as string,
    secretAccessKey: config.spaces.secret as string,
  },
});

const fileUploadHandler = () => {
  const storage = multer.memoryStorage();

  const filterFilter = (req: Request, file: any, cb: FileFilterCallback) => {
    const imageFields = ["image", "profile", "coverPhoto"];
    if (imageFields.includes(file.fieldname)) {
      if (["image/jpeg", "image/png", "image/jpg"].includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new ApiError(StatusCodes.BAD_REQUEST, "Only .jpeg, .png, .jpg supported"));
      }
    } else if (file.fieldname === "excel") {
      if (
        file.mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
        file.mimetype === "text/csv" ||
        file.mimetype === "application/vnd.ms-excel"
      ) {
        cb(null, true);
      } else {
        cb(new ApiError(StatusCodes.BAD_REQUEST, "Only .xlsx or .csv supported"));
      }
    } else {
      cb(new ApiError(StatusCodes.BAD_REQUEST, "This file is not supported"));
    }
  };

  const upload = multer({
    storage,
    fileFilter: filterFilter,
    limits: { fileSize: 5 * 1024 * 1024 },
  }).fields([
    { name: "image", maxCount: 3 },
    { name: "profile", maxCount: 1 },
    { name: "coverPhoto", maxCount: 1 },
    { name: "excel", maxCount: 1 },
  ]);

  const uploadToSpaces = async (file: Express.Multer.File, folder: string) => {
    const fileExt = path.extname(file.originalname);
    const fileName =
      file.originalname.replace(fileExt, "").toLowerCase().split(" ").join("-") +
      "-" + Date.now() + fileExt;
    const key = `uploads/${folder}/${fileName}`;

    await s3Client.send(new PutObjectCommand({
      Bucket: config.spaces.bucket,
      Key: key,
      Body: file.buffer,
      ACL: "public-read",
      ContentType: file.mimetype,
    }));

    return `/${key}`; // relative path — VITE_MEDIA_URL isay prefix karega, jaisa pehle hota tha
  };

  const middleware = (req: Request, res: any, next: any) => {
    upload(req, res, async (err: any) => {
      if (err) return next(err);
      try {
        if (req.files) {
          const files = req.files as { [key: string]: Express.Multer.File[] };
          for (const key of Object.keys(files)) {
            const folder = key === "excel" ? "excels" : "images";
            for (const file of files[key]) {
              file.path = await uploadToSpaces(file, folder);
            }
          }
        }
        next();
      } catch (uploadErr) {
        next(uploadErr);
      }
    });
  };

  return middleware;
};

export default fileUploadHandler;