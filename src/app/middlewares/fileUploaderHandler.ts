// middlewares/fileUploaderHandler.ts

import { Request } from "express";
import { StatusCodes } from "http-status-codes";
import multer, { FileFilterCallback } from "multer";
import path from "path";
import { promises as fsp } from "fs";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import ApiError from "../../errors/ApiErrors";
import config from "../../config";
import { logger } from "../../shared/logger";

/* ==========================================================
   STORAGE MODE
   ==========================================================

   Do modes hain:

   1) SPACES  -> jab chaaron DO_SPACES_* env variables mojood hon.
                 File DigitalOcean Spaces par jaati hai aur DB mein
                 poora absolute CDN URL save hota hai.
                 Production mein hamesha yehi mode hona chahiye.

   2) LOCAL   -> jab Spaces configured na ho (aam tor par local
                 development machine). File `uploads/` folder mein
                 save hoti hai aur relative path return hota hai.
                 Ye sirf development ke liye hai.

   Is tarah developer ko local par kaam karne ke liye Spaces ki
   credentials ki zaroorat nahi rehti.
========================================================== */

const spacesConfigured = Boolean(
  config.spaces.key &&
    config.spaces.secret &&
    config.spaces.endpoint &&
    config.spaces.bucket
);

/** CDN base URL, trailing slash ke bagair */
const cdnBaseUrl = (config.spaces.cdnUrl || "").trim().replace(/\/+$/, "");

/** Local disk par uploads ka root folder */
const localUploadRoot = path.join(process.cwd(), "uploads");

const s3Client = spacesConfigured
  ? new S3Client({
      endpoint: config.spaces.endpoint,
      region: "us-east-1", // DO Spaces isay ignore karta hai, SDK ko chahiye hota hai
      forcePathStyle: false,
      credentials: {
        accessKeyId: config.spaces.key as string,
        secretAccessKey: config.spaces.secret as string,
      },
    })
  : null;

/* ---------- startup par saaf saaf bata do kaunsa mode chal raha hai ---------- */

if (!spacesConfigured) {
  const missing: string[] = [];
  if (!config.spaces.key) missing.push("DO_SPACES_KEY");
  if (!config.spaces.secret) missing.push("DO_SPACES_SECRET");
  if (!config.spaces.endpoint) missing.push("DO_SPACES_ENDPOINT");
  if (!config.spaces.bucket) missing.push("DO_SPACES_BUCKET");

  if (config.node_env === "production") {
    logger.error(
      `UPLOADS: Spaces configured nahi hai (missing: ${missing.join(", ")}). ` +
        "Files local disk par ja rahi hain. Production mein ye GHALAT hai, " +
        "server restart ya IP change par saari images toot jayengi. " +
        ".env mein DO_SPACES_* variables set karein."
    );
  } else {
    logger.warn(
      `UPLOADS: LOCAL disk mode (missing: ${missing.join(", ")}). ` +
        "Development ke liye theek hai. Files uploads/ folder mein jayengi."
    );
  }
} else if (!cdnBaseUrl) {
  logger.warn(
    "UPLOADS: SPACES mode chal raha hai lekin DO_SPACES_CDN_URL set nahi hai. " +
      "Relative path save hoga aur host badalne par images toot jayengi. " +
      "Please .env mein DO_SPACES_CDN_URL set karein."
  );
} else {
  logger.info(`UPLOADS: SPACES mode, CDN base = ${cdnBaseUrl}`);
}

/* ==========================================================
   HELPERS
========================================================== */

const buildFileName = (file: Express.Multer.File) => {
  const fileExt = path.extname(file.originalname);

  const safeName =
    file.originalname
      .replace(fileExt, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "file";

  return `${safeName}-${Date.now()}${fileExt}`;
};

/** Spaces par upload karke public URL wapas deta hai */
const uploadToSpaces = async (file: Express.Multer.File, folder: string) => {
  const key = `uploads/${folder}/${buildFileName(file)}`;

  await s3Client!.send(
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
   * Absolute URL return karna zaroori hai.
   *
   * Pehle sirf `/${key}` return hota tha, aur clients us ke aage apna
   * API domain laga dete the (https://api.rewaldo.com/uploads/...),
   * jahan file hoti hi nahi thi kyunke file bucket mein jaati hai.
   * Isi liye har jagah image blank aa rahi thi.
   */
  if (cdnBaseUrl) {
    return `${cdnBaseUrl}/${key}`;
  }

  return `/${key}`;
};

/** Local disk par save karke relative path wapas deta hai (development) */
const saveToLocalDisk = async (file: Express.Multer.File, folder: string) => {
  const dir = path.join(localUploadRoot, folder);
  await fsp.mkdir(dir, { recursive: true });

  const fileName = buildFileName(file);
  await fsp.writeFile(path.join(dir, fileName), file.buffer);

  // app.ts mein `app.use("/uploads", express.static(...))` isay serve karta hai
  return `/uploads/${folder}/${fileName}`;
};

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
        cb(
          new ApiError(
            StatusCodes.BAD_REQUEST,
            "Only .jpeg, .png, .jpg supported"
          )
        );
      }
    } else if (file.fieldname === "excel") {
      if (
        file.mimetype ===
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
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

  const storeFile = async (file: Express.Multer.File, folder: string) =>
    spacesConfigured
      ? await uploadToSpaces(file, folder)
      : await saveToLocalDisk(file, folder);

  const middleware = (req: Request, res: any, next: any) => {
    upload(req, res, async (err: any) => {
      if (err) return next(err);

      try {
        if (req.files) {
          const files = req.files as {
            [key: string]: Express.Multer.File[];
          };

          for (const key of Object.keys(files)) {
            const folder = key === "excel" ? "excels" : "images";

            for (const file of files[key]) {
              // Controllers ye value `getUploadedFileUrl()` ke zariye parhte hain
              file.path = await storeFile(file, folder);
            }
          }
        }

        next();
      } catch (uploadErr) {
        logger.error("File upload failed", uploadErr);
        next(uploadErr);
      }
    });
  };

  return middleware;
};

export default fileUploadHandler;