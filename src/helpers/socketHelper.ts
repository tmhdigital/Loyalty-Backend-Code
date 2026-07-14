import { Server, Socket } from "socket.io";
import colors from "colors";
import { Secret } from "jsonwebtoken";
import config from "../config";
import { jwtHelper } from "./jwtHelper";
import { logger } from "../shared/logger";

const socket = (io: Server) => {
  io.on("connection", async (socket: Socket) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        (socket.handshake.headers.token as string);

      if (!token) {
        socket.emit("auth_error", "Authentication token required");
        return socket.disconnect(true);
      }

      const verifiedUser = jwtHelper.verifyToken(
        token,
        config.jwt.jwt_secret as Secret
      );

      if (!verifiedUser?.id) {
        socket.emit("auth_error", "Invalid token");
        return socket.disconnect(true);
      }

      socket.data.userId = verifiedUser.id;
      socket.join(`user:${verifiedUser.id}`);

      logger.info(colors.blue(`User connected: ${verifiedUser.id}`));

      socket.on("disconnect", () => {
        logger.info(colors.red(`User disconnected: ${socket.data.userId}`));
        // no DB write needed — socket.io auto-leaves the room
      });
    } catch (error) {
      logger.error(error);
      socket.emit("auth_error", "Authentication failed");
      socket.disconnect(true);
    }
  });
};

export const socketHelper = { socket };