import mongoose from "mongoose";
import app from "./app";
import config from "./config";
import { errorLogger, logger } from "./shared/logger";
import colors from "colors";
import { Server } from "socket.io";
import seedSuperAdmin from "./DB";
import { socketHelper } from "./helpers/socketHelper";
import { startCronJobs, stopCronJobs } from "./cronJobs"; 
import { cleanupStaleSockets } from "./utils/cleanupSocket";
import { validateEnv } from "./config/env.validation";
import { initSocket, getIO } from "./utils/socket";
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

    await mongoose.connect(config.database_url as string);
    logger.info(colors.green("🚀 Database connected successfully"));

    // ─── Drop stale indexes (one-time cleanup) ─────────────────────────
    try {
      const db = mongoose.connection.db;
      if (db) {
        // Drop old cardCode_1 index from digitalcardpromotions (stale from old schema)
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

    // start cron jobs
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
      cors: {
        origin: "*",
      },
    });

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
        // 1. Stop cron jobs first
        stopCronJobs();

        // 2. Stop interval jobs
        clearInterval(cleanupInterval);

        // 3. Close socket server
        io.close(() => {
          logger.info("Socket server closed");
        });

        // 4. Close HTTP server
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