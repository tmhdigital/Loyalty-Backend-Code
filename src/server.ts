import mongoose from "mongoose";
import app, { corsOptions } from "./app";
import config from "./config";
import { errorLogger, logger } from "./shared/logger";
import colors from "colors";
import { Server } from "socket.io";
import seedSuperAdmin from "./DB";
import { socketHelper } from "./helpers/socketHelper";
import { startCronJobs, stopCronJobs } from "./cronJobs";
import { cleanupStaleSockets } from "./utils/cleanupSocket";
import { validateEnv } from "./config/env.validation";
import { connectRedis, pubClient, subClient } from "./config/redisClients";
import { createAdapter } from "@socket.io/redis-adapter";
let server: any;

// uncaught exception
process.on("uncaughtException", (error) => {
  errorLogger.error("uncaughtException Detected", error);
  process.exit(1);
});

async function main() {
  try {
    // 🔐 ENV validation FIRST
    validateEnv();

    // ─── CHANGE (file 01): tuned connection pool ───────────────────────
    // Sized for your DigitalOcean Managed MongoDB (1 CPU / 1 GB) and 2 PM2
    // cluster workers. Pool is PER WORKER, so total connections = maxPoolSize
    // × 2. With maxPoolSize 10 that's 20 total — safe for a 1GB DB. Do NOT
    // raise this much without upgrading the DB plan; too many connections
    // exhaust the small DB's memory. Timeouts make slow-DB requests fail fast
    // instead of hanging worker threads. Behaviour is otherwise unchanged.
    await mongoose.connect(config.database_url as string, {
      maxPoolSize: 10,
      minPoolSize: 2,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      maxIdleTimeMS: 60000,
    });
    logger.info(colors.green("🚀 Database connected successfully"));

    // ─── Drop stale indexes (one-time cleanup) ─────────────────────────
    try {
      const db = mongoose.connection.db;
      if (db) {
        await db.collection("digitalcardpromotions").dropIndex("cardCode_1");
        logger.info(colors.yellow("🧹 Dropped stale index: digitalcardpromotions.cardCode_1"));
      }
    } catch (indexErr: any) {
      if (indexErr?.codeName === "IndexNotFound" || indexErr?.code === 27) {
        // Index already gone — nothing to do
      } else {
        logger.error("Index cleanup warning:", indexErr?.message);
      }
    }
    // ───────────────────────────────────────────────────────────────────

    await seedSuperAdmin();

    // ─── CHANGE (file 10): connect Redis BEFORE accepting requests ─────
    // Sessions (Redis store) and the Socket.IO adapter both depend on Redis
    // being connected. Previously connectRedis() ran AFTER app.listen(),
    // leaving a tiny startup window where a request could hit the Redis
    // session store before Redis was ready. Connecting here closes that gap.
    // If Redis is down we DON'T crash — session store and auth cache both
    // fall back safely — we just log it loudly.
    if (process.env.REDIS_URL) {
      try {
        await connectRedis();
        logger.info(colors.green("Redis connected before server start"));
      } catch (err: any) {
        logger.error(`Redis connect failed at startup: ${err?.message}`);
      }
    }

    // start cron jobs (guarded to run on one worker only — see file 09)
    await startCronJobs();

    const port =
      typeof config.port === "number"
        ? config.port
        : Number(config.port);

    server = app.listen(port, "0.0.0.0", () => {
      logger.info(
        `Worker ${process.pid} listening on port:${config.port}`
      );
    });

    // socket setup
    const io = new Server(server, {
      pingTimeout: 60000,
      cors: corsOptions,
    });

    // ─── CHANGE (file 10): Redis already connected above; just attach ──
    // the adapter. Guarded on isReady so a failed Redis connect above can't
    // throw here.
    if (process.env.REDIS_URL && pubClient.isReady && subClient.isReady) {
      io.adapter(createAdapter(pubClient, subClient));
      logger.info("Socket.IO Redis adapter attached");
    }

    socketHelper.socket(io);

    global.io = io;

    // cleanup interval (store reference for shutdown)
    const cleanupInterval = setInterval(() => {
      cleanupStaleSockets(io).catch((err) => {
        logger.error("cleanupStaleSockets failed", {
          error: err.message,
          stack: err.stack,
        });
      });
    }, 5 * 60 * 1000);

    // 🔥 GRACEFUL SHUTDOWN (SIGTERM)
    process.on("SIGTERM", async () => {
      logger.info("SIGTERM received");

      try {
        stopCronJobs();
        clearInterval(cleanupInterval);

        io.close(() => {
          logger.info("Socket server closed");
        });

        if (server) {
          server.close(() => {
            logger.info("HTTP server closed");
          });
        }
      } catch (error) {
        errorLogger.error("Error during graceful shutdown", error);
      }
    });

    // handle unhandledRejection
    process.on("unhandledRejection", (error) => {
      errorLogger.error("UnhandledRejection Detected", error);
      process.exit(1);
    });
  } catch (error) {
    errorLogger.error(
      colors.red("🤢 Failed to connect Database"),
      error
    );
    process.exit(1);
  }
}

main();