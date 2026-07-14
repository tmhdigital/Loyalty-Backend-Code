import { createClient } from "redis";
import config from "./index";
import { logger } from "../shared/logger";

export const pubClient = createClient({ url: config.redis_url });
export const subClient = pubClient.duplicate();

export const connectRedis = async () => {
  await Promise.all([pubClient.connect(), subClient.connect()]);
  logger.info("Redis pub/sub clients connected");
};