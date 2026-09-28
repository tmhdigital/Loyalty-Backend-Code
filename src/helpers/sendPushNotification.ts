import admin from "firebase-admin"; // firebase-admin init করা আছে ধরে নিই
import { logger } from "../shared/logger";
import { User } from "../app/modules/user/user.model";
import { DEAD_FCM_TOKEN_CODES } from "./removeInvalidFcmTokens";

export const sendPushNotification = async (fcmToken: string, title: string, body: string, data?: Record<string, string>) => {
  if (!fcmToken) return;

  

  const message = {
    token: fcmToken,
    notification: { title, body },
    data: data || {},
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
