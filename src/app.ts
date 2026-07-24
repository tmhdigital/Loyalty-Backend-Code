import express, { Request, Response } from "express";
import path from "path";
import cors from "cors";
import { StatusCodes } from "http-status-codes";
import { Morgan } from "./shared/morgan";

import globalErrorHandler from "./app/middlewares/globalErrorHandler";
import session from "express-session";
import helmet from "helmet";
import mongoSanitize from "express-mongo-sanitize";
import xss from "xss-clean";
import cookieParser from "cookie-parser";

// Subscription Routes import
import handleStripeWebhook from "./helpers/handleStripeWebhook";
import { logger } from "./shared/logger";
import router from "./app/routes";
import config from "./config";

const app = express();

/* ==========================================================
   CORS CONFIGURATION
========================================================== */

const allowedOrigins = [
  // Production
  config.client_url,
  config.admin_url,

  // Local development (sirf production ke ilawa)
  ...(config.node_env !== "production" ? [
    "http://localhost:3000",
    "http://localhost:3003",
    "http://localhost:3004",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "http://10.10.26.175:3003",
    "http://10.10.26.175:3004",
    "http://31.97.117.41:3003",
    "http://31.97.117.41:3004",
    "http://172.17.80.1:3000",
    "http://192.168.32.1:3000",
  ] : []),
].filter(Boolean);

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow mobile apps, Postman, server-to-server requests
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // Allow all Vercel preview deployments
    if (
      origin.endsWith(".vercel.app") &&
      (origin.includes("rewaldo-admin") ||
        origin.includes("rewaldo-business"))
    ) {
      return callback(null, true);
    }

    logger.warn(`CORS blocked: ${origin}`);

    callback(new Error(`Origin ${origin} not allowed by CORS`));
  },

  credentials: true,

  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],

  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "Accept",
    "Origin",
  ],
};

/* ==========================================================
   STRIPE WEBHOOK (MUST COME BEFORE JSON PARSER)
========================================================== */

app.post(
  "/api/v1/subscription/webhook",
  express.raw({ type: "application/json" }),
  handleStripeWebhook
);

/* ==========================================================
   MIDDLEWARES
========================================================== */

// Morgan
app.use(Morgan.successHandler);
app.use(Morgan.errorHandler);

// Cookie parser
app.use(cookieParser());

// CORS
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// Security
app.use(
  helmet({
    crossOriginResourcePolicy: {
      policy: "cross-origin",
    },
  })
);

app.use(mongoSanitize());
app.use(xss());

// Body parsers
app.use(express.json({ limit: "10mb" }));
app.use(
  express.urlencoded({
    limit: "10mb",
    extended: true,
  })
);

// Static files
//
// NOTE: pehle ye `express.static("uploads")` tha, jo `uploads` folder ko root `/`
// par serve karta tha. Us se DB mein save shuda path `/uploads/images/x.jpg`
// disk par `uploads/uploads/images/x.jpg` dhoondta tha, jo kabhi mila hi nahi.
//
// Naye uploads ab DigitalOcean Spaces par jaate hain aur DB mein poora CDN URL
// save hota hai. Ye mount sirf purane (legacy) local files ke liye rakha gaya hai
// taake migration ke doran purani images bhi khulti rahein.
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

/* ==========================================================
   SESSION
========================================================== */

app.use(
  session({
    secret: process.env.SESSION_SECRET as string,

    resave: false,
    saveUninitialized: false,

    cookie: {
      secure: process.env.NODE_ENV === "production",

      httpOnly: true,

      // Required when frontend and backend are on different domains
      sameSite:
        process.env.NODE_ENV === "production"
          ? "none"
          : "lax",

      maxAge: 1000 * 60 * 60 * 24, // 1 day
    },
  })
);

/* ==========================================================
   REQUEST LOGGER
========================================================== */

app.use((req: Request, res: Response, next) => {
  const start = Date.now();

  res.on("finish", () => {
    logger.info("HTTP Request", {
      worker: process.pid,
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      responseTime: Date.now() - start,
    });
  });

  next();
});

/* ==========================================================
   HEALTH CHECK
========================================================== */

app.get("/health", (req: Request, res: Response) => {
  res.status(StatusCodes.OK).json({
    success: true,
    message: "Server is healthy",
    uptime: process.uptime(),
  });
});

/* ==========================================================
   ROUTES
========================================================== */

app.use("/api/v1", router);

app.get("/", (req: Request, res: Response) => {
  res.send("Hey Backend, How can I assist you");
});

/* ==========================================================
   ERROR HANDLERS
========================================================== */

app.use(globalErrorHandler);

app.use((req: Request, res: Response) => {
  res.status(StatusCodes.NOT_FOUND).json({
    success: false,
    message: "Not Found",
    errorMessages: [
      {
        path: req.originalUrl,
        message: "API DOESN'T EXIST",
      },
    ],
  });
});

export default app;
// Comment added to check the CI working properly or not.