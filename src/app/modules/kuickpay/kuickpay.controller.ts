import { Request, Response } from "express";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { StatusCodes } from "http-status-codes";
import { KuickpayService } from "./kuickpay.service";
import { logger } from "../../../shared/logger";

const initiateCheckout = catchAsync(async (req: Request, res: Response) => {
  const { packageId } = req.body;
  if (!req.user) throw new Error("User not found");
  if (!packageId) throw new Error("Package ID is required");

  const userId = (req.user as any)._id || (req.user as any).id;
  if (!userId) throw new Error("User ID not found");

  const data = await KuickpayService.createKuickpayCheckout(userId, packageId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Kuickpay checkout initiated successfully",
    data,
  });
});

/**
 * Bridge page the customer's browser (inside the app's WebView) is redirected to
 * after completing/cancelling payment on the Kuickpay hosted page.
 * The mobile app's WebView navigation delegate watches for "/kuickpay/return"
 * in the URL (same pattern already used for the Stripe flow) and shows its own
 * success/failure screen — this page just needs to render *something*.
 */
const handleReturn = catchAsync(async (req: Request, res: Response) => {
  try {
    const result = await KuickpayService.verifyAndActivate(
      req.query as Record<string, any>,
      "return"
    );

    res
      .status(StatusCodes.OK)
      .send(
        result.success
          ? "<h3>Payment successful. You can return to the app.</h3>"
          : "<h3>Payment failed. You can return to the app.</h3>"
      );
  } catch (error) {
    logger.error("Kuickpay return handling failed", error);
    res
      .status(StatusCodes.OK) // still 200 so the WebView finishes loading and the app can detect the path
      .send("<h3>Payment could not be verified. You can return to the app.</h3>");
  }
});

/**
 * Server-to-server Instant Payment Notification. Kuickpay calls this directly —
 * no user session/auth is available here, only signature verification.
 */
const handleIpn = catchAsync(async (req: Request, res: Response) => {
  const payload = { ...req.query, ...req.body } as Record<string, any>;

  try {
    await KuickpayService.verifyAndActivate(payload, "ipn");
    res.status(StatusCodes.OK).json({ received: true });
  } catch (error) {
    logger.error("Kuickpay IPN handling failed", error);
    // Respond 200 anyway once logged — Kuickpay may retry on non-200, but if the
    // signature is invalid retries won't help; a 400 is fine to signal that too.
    res.status(StatusCodes.BAD_REQUEST).json({ received: false });
  }
});

export const KuickpayController = {
  initiateCheckout,
  handleReturn,
  handleIpn,
};
