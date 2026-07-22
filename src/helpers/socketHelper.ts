import { Server, Socket } from "socket.io";
import colors from "colors";
import { Secret } from "jsonwebtoken";
import config from "../config";
import { jwtHelper } from "./jwtHelper";
import { User } from "../app/modules/user/user.model";
import { logger } from "../shared/logger";

const MAX_SOCKET_CONNECTIONS_PER_USER = 3;

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

      const user = await User.findById(verifiedUser.id).select("socketIds");
      if (!user) {
        socket.emit("auth_error", "User not found");
        return socket.disconnect(true);
      }

      // attach user info to socket (very important)
      socket.data.userId = verifiedUser.id;

      const uniqueSocketIds = Array.from(
        new Set([...(user.socketIds || []), socket.id])
      );

      if (uniqueSocketIds.length > MAX_SOCKET_CONNECTIONS_PER_USER) {
        const excess = uniqueSocketIds.length - MAX_SOCKET_CONNECTIONS_PER_USER;
        const staleSocketIds = uniqueSocketIds.slice(0, excess);
        const keptSocketIds = uniqueSocketIds.slice(excess);

        await User.findByIdAndUpdate(verifiedUser.id, {
          socketIds: keptSocketIds,
        });

        staleSocketIds.forEach((staleSocketId) => {
          const staleSocket = io.sockets.sockets.get(staleSocketId);
          if (staleSocket) {
            staleSocket.disconnect(true);
            logger.info(
              colors.yellow(
                `Disconnected stale socket ${staleSocketId} for user ${verifiedUser.id}`
              )
            );
          }
        });
      } else {
        await User.findByIdAndUpdate(verifiedUser.id, {
          $addToSet: { socketIds: socket.id },
        });
      }

      logger.info(colors.blue(`User connected: ${verifiedUser.id}`));

      socket.on("disconnect", async () => {
        await User.findByIdAndUpdate(socket.data.userId, {
          $pull: { socketIds: socket.id },
        });

        logger.info(colors.red(`User disconnected: ${socket.data.userId}`));
      });
    } catch (error) {
      logger.error(error);
      socket.emit("auth_error", "Authentication failed");
      socket.disconnect(true);
    }
  });
};

export const socketHelper = { socket };
