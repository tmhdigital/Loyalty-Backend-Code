// middlewares/fileUploaderHandler.ts

import { Request } from "express";
import { StatusCodes } from "http-status-codes";
import multer, { FileFilterCallback } from "multer";
import path from "path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import ApiError from "../../errors/ApiErrors";
import config from "../../config";
import { logger } from "../../shared/logger";

/* ==========================================================
   DIGITAL OCEAN SPACES CLIENT
========================================================== */

const s3Client = new S3Client({
  endpoint: config.spaces.endpoint,
  region: "us-east-1", // DO Spaces isay ignore karta hai, SDK ko chahiye hota hai
  forcePathStyle: false,
  credentials: {
    accessKeyId: config.spaces.key as string,
    secretAccessKey: config.spaces.secret as string,
  },
});

/**
 * CDN base URL, trailing slash ke bagair.
 * Example: https://rewaldo-media.blr1.cdn.digitaloceanspaces.com
 * Ya custom domain: https://cdn.rewaldo.com
 */
const cdnBaseUrl = (config.spaces.cdnUrl || "").trim().replace(/\/+$/, "");

/**
 * Startup par hi bata do agar koi env variable missing hai.
 * Warna upload ke waqt aik confusing 500 aata hai.
 */
const assertSpacesConfig = () => {
  const missing: string[] = [];

  if (!config.spaces.key) missing.push("DO_SPACES_KEY");
  if (!config.spaces.secret) missing.push("DO_SPACES_SECRET");
  if (!config.spaces.endpoint) missing.push("DO_SPACES_ENDPOINT");
  if (!config.spaces.bucket) missing.push("DO_SPACES_BUCKET");

  if (missing.length > 0) {
    throw new ApiError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      `File upload is not configured. Missing env: ${missing.join(", ")}`
    );
  }
};

if (!cdnBaseUrl) {
  logger.warn(
    "DO_SPACES_CDN_URL set nahi hai. Uploaded files ka relative path save hoga, " +
      "aur host badalne par images toot jayengi. Please .env mein DO_SPACES_CDN_URL set karein."
  );
}

/* ==========================================================
   UPLOAD HANDLER
========================================================== */

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
    const safeName =
      file.originalname
        .replace(fileExt, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "file";

    const fileName = `${safeName}-${Date.now()}${fileExt}`;
    const key = `uploads/${folder}/${fileName}`;

    await s3Client.send(
      new PutObjectCommand({
        Bucket: config.spaces.bucket,
        Key: key,
        Body: file.buffer,
        ACL: "public-read",
        ContentType: file.mimetype,
        CacheControl: "public, max-age=31536000, immutable",
      })
    );

    /**
     * YAHAN ASLI FIX HAI.
     *
     * Pehle sirf `/${key}` return hota tha. Clients us relative path ke aage
     * API domain laga dete the (https://api.rewaldo.com/uploads/...), jahan
     * file hoti hi nahi thi kyunke file Spaces bucket mein jaati hai.
     * Isi liye har jagah image blank aa rahi thi.
     *
     * Ab poora absolute CDN URL DB mein save hota hai, is liye backend ka
     * host ya IP badalne se images kabhi nahi tootengi.
     */
    if (cdnBaseUrl) {
      return `${cdnBaseUrl}/${key}`;
    }

    // Fallback: agar CDN URL configured nahi hai to purana behaviour
    return `/${key}`;
  };

  const middleware = (req: Request, res: any, next: any) => {
    upload(req, res, async (err: any) => {
      if (err) return next(err);

      try {
        if (req.files) {
          const files = req.files as { [key: string]: Express.Multer.File[] };

          // Sirf tab check karo jab waqai koi file aayi ho
          if (Object.keys(files).length > 0) {
            assertSpacesConfig();
          }

          for (const key of Object.keys(files)) {
            const folder = key === "excel" ? "excels" : "images";
            for (const file of files[key]) {
              file.path = await uploadToSpaces(file, folder);
            }
          }
        }
        next();
      } catch (uploadErr) {
        logger.error("File upload to Spaces failed", uploadErr);
        next(uploadErr);
      }
    });
  };

  return middleware;
};

export default fileUploadHandler;