import type { BatchResponse } from "firebase-admin/messaging";
import { User } from "../app/modules/user/user.model";
import { logger } from "../shared/logger";

// Token is dead for good (app uninstalled, token expired or malformed).
export const DEAD_FCM_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

// Token belongs to another Firebase project (e.g. the old project before the
// migration). FCM also returns this for EVERY token when our own service
// account is wrong, so it is only trusted when some token in the batch worked.
const WRONG_PROJECT_CODE = "messaging/mismatched-credential";

/** Unsets fcmToken on users whose token FCM reported as permanently invalid. */
export const removeInvalidFcmTokens = async (
  tokens: string[],
  response: BatchResponse
) => {
  const invalid = response.responses.flatMap((res, i) => {
    const code = res.error?.code;
    if (!code) return [];
    if (DEAD_FCM_TOKEN_CODES.has(code)) return [tokens[i]];
    if (code === WRONG_PROJECT_CODE && response.successCount > 0) return [tokens[i]];
    return [];
  });

  if (!invalid.length) return;

  try {
    const result = await User.updateMany(
      { fcmToken: { $in: invalid } },
      { $unset: { fcmToken: 1 } }
    );
    logger.info("Removed invalid FCM tokens", { count: result.modifiedCount });
  } catch (err) {
    logger.error("Failed to remove invalid FCM tokens", err);
  }
};
