// src/helpers/notificationsHelper.ts

import { Types } from "mongoose";
import { User } from "../app/modules/user/user.model";
import {
  Notification,
  NotificationType,
} from "../app/modules/notification/notification.model";
import { INotification } from "../app/modules/notification/notification.interface";

import { getIO } from "../utils/socket";

interface SendNotificationInput {
  userIds: Types.ObjectId[] | string[];
  title: string;
  body: string;
  type: NotificationType;
  metadata?: Record<string, unknown>;
  attachments?: string[];
  channel?: {
    socket?: boolean;
    push?: boolean;
  };
}

export const sendNotification = async ({
  userIds,
  title,
  body,
  type,
  metadata,
  attachments,
  channel = { socket: true, push: false },
}: SendNotificationInput) => {
  if (!userIds?.length) return [];

  // 1. Save notifications
  const notifications = await Notification.insertMany(
    userIds.map((userId) => ({
      userId,
      title,
      body,
      type,
      metadata,
      attachments,
      channel,
    })),
    { ordered: false }
  );

  // 2. Socket emit
  if (channel.socket) {
    const io = getIO();

    if (io) {
      const users = await User.find({
        _id: { $in: userIds },
      }).select("_id socketIds");

      const notificationMap = new Map<string, INotification[]>();

      notifications.forEach((notification) => {
        const key = notification.userId.toString();

        if (!notificationMap.has(key)) {
          notificationMap.set(key, []);
        }

        notificationMap.get(key)?.push(notification);
      });

      users.forEach((user) => {
        const userNotifications = notificationMap.get(user._id.toString());

        if (!userNotifications?.length) return;

        user.socketIds?.forEach((socketId: string) => {
          userNotifications.forEach((notification) => {
            io.to(socketId).emit("newNotification", notification);
          });
        });
      });
    } else {
      console.warn("⚠️ Socket.io is not initialized. Skipping socket notification emit.");
    }
  }

  // 3. Push notification future implementation
  if (channel.push) {
    // FCM / APNS
  }

  return notifications;
};