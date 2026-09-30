import admin from "firebase-admin"; // firebase-admin init করা আছে ধরে নিই
import { logger } from "../shared/logger";
import { User } from "../app/modules/user/user.model";
import { DEAD_FCM_TOKEN_CODES } from "./removeInvalidFcmTokens";

export const sendPushNotification = async (fcmToken: string, title: string, body: string, data?: Record<string, string>) => {
  if (!fcmToken) return;

  

  // android/apns blocks: high priority + sound so the notification pops up
  // (same as push.service.ts; the channel is created by both apps)
  const message: admin.messaging.Message = {
    token: fcmToken,
    notification: { title, body },
    data: data || {},
    android: {
      priority: "high",
      notification: { channelId: "high_importance_channel", sound: "default" },
    },
    apns: {
      headers: { "apns-priority": "10" },
      payload: { aps: { sound: "default" } },
    },
  };

  try {
    await admin.messaging().send(message);

  } catch (err) {
    logger.error("Something failed", err);

    // Uninstalled app / expired token: stop sending to it
    const code = (err as { code?: string })?.code;
    if (code && DEAD_FCM_TOKEN_CODES.has(code)) {
      await User.updateOne({ fcmToken }, { $unset: { fcmToken: 1 } }).catch(() => undefined);
    }
  }
};
