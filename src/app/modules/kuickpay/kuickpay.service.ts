import axios from "axios";
import config from "../../../config";
import { Package } from "../package/package.model";
import { User } from "../user/user.model";
import { Subscription } from "../subscription/subscription.model";
import { KuickpayOrder } from "./kuickpayOrder.model";
import { calculateEndDate } from "../../../helpers/dateHelper";
import {
  buildRedirectionSignature,
  getKuickpayRedirectionUrl,
  getKuickpayTokenUrl,
  KUICKPAY_RESPONSE_CODE_SUCCESS,
  toKuickpayLocalMobile,
  verifyReturnSignatureDetailed,
} from "./kuickpay.util";
import { logger } from "../../../shared/logger";
import {
  calculateUsablePoints,
  grantReferralBonusOnSubscription,
} from "../referral/referral.helper";

import {
  KuickpayInitiateResponse,
  KuickpayTokenResponse,
} from "./kuickpay.interface";

// =========================
// 1) Get Auth Token (server-to-server, secured key never leaves backend)
// =========================
const getAuthToken = async (): Promise<string> => {
  const institutionID = config.kuickpay.institutionId;
  const kuickpaySecuredKey = config.kuickpay.securedKey;

  if (!institutionID || !kuickpaySecuredKey) {
    throw new Error("Kuickpay credentials are not configured");
  }

  const response = await axios.post<KuickpayTokenResponse>(
    getKuickpayTokenUrl(),
    { institutionID, kuickpaySecuredKey },
    {
      headers: {
        "Content-Type": "application/json",
        // Guide notes: "Empty user agent not allowed"
        "User-Agent": "Rewaldo-Mobile-App/1.0",
      },
      timeout: 15000,
    }
  );

  const token = response.data?.auth_token;
  if (!token) {
    throw new Error("Kuickpay did not return an auth_token");
  }

  return token;
};

// =========================
// 2) Create checkout order — mirrors the pricing/points logic already used for Stripe
// =========================
const createKuickpayCheckout = async (
  userId: string,
  packageId: string
): Promise<KuickpayInitiateResponse> => {
  const pkg = await Package.findById(packageId);
  if (!pkg) throw new Error("Package not found");

  const user = await User.findById(userId);
  if (!user) throw new Error("User not found");

  if (pkg.isFreeTrial) {
    throw new Error(
      "Free trial packages don't require payment — use the free-plan flow instead"
    );
  }

  // Points earned from referrals are applied as a discount here, capped at 80%
  // of the package price (shared rule — see referral.helper.ts).
  const userPoints = user.points || 0;
  const usablePoints = calculateUsablePoints(pkg.price, userPoints);
  const finalPrice = pkg.price - usablePoints;

  // Kuickpay expects Amount/GrossAmount/TaxAmount as INTEGER PAISA — no decimal
  // point (Rupees x 100). Confirmed against Kuickpay's own working Postman
  // example: Amount="10000" for a Rs 100 transaction.
  const amountStr = Math.round(finalPrice * 100).toString();
const grossAmountStr = Math.round(pkg.price * 100).toString();
const taxAmountStr = "0";

  const institutionID = config.kuickpay.institutionId as string;
  const securedKey = config.kuickpay.securedKey as string;

  if (!institutionID || !securedKey) {
    throw new Error("Kuickpay credentials are not configured");
  }
  if (!config.kuickpay.successUrl || !config.kuickpay.failureUrl) {
    throw new Error("KUICKPAY_SUCCESS_URL / KUICKPAY_FAILURE_URL not configured");
  }
  if (!config.kuickpay.checkoutIpnUrl) {
    throw new Error("KUICKPAY_CHECKOUT_IPN_URL not configured");
  }

  // Kuickpay requires OrderID: numeric only, max 18 characters.
  // Millisecond timestamp (13 digits) + 3 random digits — unique and within limit.
  const orderId = (
    Date.now().toString() + Math.floor(Math.random() * 1000).toString().padStart(3, "0")
  ).slice(0, 18);

  await KuickpayOrder.create({
    orderId,
    user: userId,
    package: packageId,
    amount: finalPrice,
    grossAmount: pkg.price,
    taxAmount: 0,
    pointsUsed: usablePoints,
    status: "pending",
  });

  const token = await getAuthToken();

  const orderDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const signature = buildRedirectionSignature(
    institutionID,
    orderId,
    amountStr,
    securedKey
  );

  return {
    redirectionUrl: getKuickpayRedirectionUrl(),
    orderId,
    formData: {
      InstitutionID: institutionID,
      OrderID: orderId,
      MerchantName: config.kuickpay.merchantName as string,
      Amount: amountStr,
      TransactionDescription: `${pkg.title} subscription`,
      CustomerMobileNumber: toKuickpayLocalMobile(user.phone),
      CustomerEmail: user.email || "",
      SuccessUrl: config.kuickpay.successUrl as string,
      FailureUrl: config.kuickpay.failureUrl as string,
      OrderDate: orderDate,
      CheckoutUrl: config.kuickpay.checkoutIpnUrl as string,
      Token: token,
      GrossAmount: grossAmountStr,
      TaxAmount: taxAmountStr,
      Discount: usablePoints > 0 ? "1" : "0",
      Signature: signature,
    },
  };
};

// =========================
// 3) Activate subscription once payment is confirmed.
//    Called from THREE places (Kuickpay's browser redirect, Kuickpay's
//    server-to-server IPN, and the app's own authenticated /confirm call).
//    Whichever arrives first wins; the rest are no-ops.
// =========================
const activateKuickpayOrder = async (params: {
  orderId: string;
  transactionId: string;
  responseCode: string;
  raw: Record<string, unknown>;
  via: "return" | "ipn" | "app-confirm";
  signatureVerified: boolean;
  signatureVariant?: string | null;
}): Promise<{
  success: boolean;
  alreadyProcessed?: boolean;
  status: "completed" | "failed";
}> => {
  const {
    orderId,
    transactionId,
    responseCode,
    raw,
    via,
    signatureVerified,
    signatureVariant,
  } = params;

  const order = await KuickpayOrder.findOne({ orderId });
  if (!order) {
    throw new Error(`Unknown Kuickpay order: ${orderId}`);
  }

  if (order.status === "completed") {
    logger.info(
      `Kuickpay order ${orderId} already completed (duplicate ${via} callback) — ignoring`
    );
    return { success: true, alreadyProcessed: true, status: "completed" };
  }

  const isSuccess = responseCode === KUICKPAY_RESPONSE_CODE_SUCCESS;

  if (via === "ipn") {
    order.rawIpn = raw;
  } else {
    order.rawReturn = raw;
  }
  order.transactionId = transactionId;
  order.responseCode = responseCode;
  order.signatureVerified = signatureVerified;
  if (signatureVariant) order.signatureVariant = signatureVariant;

  if (!isSuccess) {
    order.status = "failed";
    await order.save();
    logger.warn(
      `Kuickpay order ${orderId} marked FAILED via ${via} (ResponseCode=${responseCode})`
    );
    return { success: false, status: "failed" };
  }

  const pkg = await Package.findById(order.package);
  if (!pkg) throw new Error("Package not found while activating subscription");

  // ---- Create the subscription (idempotent) -------------------------------
  // customerId holds our own orderId, which is unique per checkout, so it is a
  // safer dedupe key than the gateway transactionId.
  let subscription = await Subscription.findOne({
    $or: [{ customerId: orderId }, { subscriptionId: transactionId }],
  });

  if (!subscription) {
    try {
      subscription = await Subscription.create({
        user: order.user,
        package: order.package,
        price: order.amount,
        subscriptionId: transactionId,
        customerId: orderId,
        trxId: transactionId,
        currentPeriodStart: new Date(),
        currentPeriodEnd: calculateEndDate(pkg.duration),
        status: "active",
        source: "kuickpay",
        remaining: 1,
      });
    } catch (error: any) {
      // Duplicate key = another callback beat us to it. Re-read and continue.
      if (error?.code === 11000) {
        subscription = await Subscription.findOne({
          $or: [{ customerId: orderId }, { subscriptionId: transactionId }],
        });
      } else {
        logger.error(
          `Kuickpay order ${orderId}: failed to create subscription`,
          error
        );
        throw error;
      }
    }
  }

  // ---- Mark the order completed ------------------------------------------
  order.status = "completed";
  order.activatedVia = via;
  if (subscription?._id) {
    order.subscription = subscription._id as any;
  }
  await order.save();

  // ---- Reflect it on the user --------------------------------------------
  // Points that were used as a discount are now actually spent — this was
  // being calculated at checkout time but never deducted.
  const userUpdate: Record<string, unknown> = {
    $set: { subscription: "active", paymentStatus: "paid" },
  };
  if (order.pointsUsed && order.pointsUsed > 0) {
    (userUpdate as any).$inc = { points: -order.pointsUsed };
  }
  await User.findByIdAndUpdate(order.user, userUpdate);

  // ---- Referral payout ----------------------------------------------------
  // If this buyer signed up with someone's referral code, that referrer now
  // earns 20% of what was paid, as points. This was implemented for the Stripe
  // and salesRep flows but was missing here, so a Kuickpay purchase never
  // rewarded the referrer and their referral screen stayed at "+0.0".
  // The helper is idempotent, so duplicate callbacks cannot double-pay.
  // Base the 20% on the PACKAGE price (grossAmount), not on what the buyer
  // actually paid after their own points discount — otherwise a discounted
  // purchase would shrink the next referrer's reward. This matches the Stripe
  // flow, which uses the plan price.
  await grantReferralBonusOnSubscription({
    subscribedUserId: order.user,
    subscriptionPrice: order.grossAmount,
  });

  logger.info(
    `Kuickpay order ${orderId} ACTIVATED via ${via} (signatureVerified=${signatureVerified}) — subscription ${subscription?._id}`
  );

  return { success: true, status: "completed" };
};

/**
 * Shared entry point for Kuickpay's own callbacks (redirect + IPN).
 * These are unauthenticated, so a valid signature is mandatory here.
 */
const verifyAndActivate = async (
  query: Record<string, any>,
  via: "return" | "ipn"
) => {
  const orderId = query.OrderId || query.orderId || query.OrderID;
  const transactionId =
    query.TransactionId || query.transactionId || query.TransactionID;
  const responseCode = query.ResponseCode || query.responseCode;
  const signature = query.Signature || query.signature;

  const check = verifyReturnSignatureDetailed({
    orderId,
    transactionId,
    responseCode,
    signature,
  });

  if (!check.valid) {
    logger.error(
      `Kuickpay ${via} signature mismatch for order ${orderId}. received=${signature} expected(documented)=${check.expected}`
    );
    throw new Error("Invalid Kuickpay signature");
  }

  return activateKuickpayOrder({
    orderId,
    transactionId,
    responseCode,
    raw: query,
    via,
    signatureVerified: true,
    signatureVariant: check.variant,
  });
};

/**
 * Called by the MOBILE APP right after its WebView lands on the return URL.
 *
 * Why this exists: the return page and the IPN both travel over the public
 * internet and can silently fail (tunnel interstitial pages, IPN not reachable,
 * webview never actually loading our host, etc). When that happens the payment
 * succeeds at Kuickpay but the user never gets their subscription — exactly the
 * bug we were seeing. This endpoint is authenticated, so we already know the
 * caller, and we can only ever activate an order that belongs to them.
 */
const confirmOrderForUser = async (
  userId: string,
  payload: Record<string, any>
) => {
  const orderId = payload.OrderId || payload.orderId || payload.OrderID;
  if (!orderId) throw new Error("orderId is required");

  const order = await KuickpayOrder.findOne({ orderId });
  if (!order) throw new Error(`Unknown Kuickpay order: ${orderId}`);

  if (String(order.user) !== String(userId)) {
    throw new Error("This order does not belong to the current user");
  }

  if (order.status === "completed") {
    return {
      status: "completed" as const,
      alreadyProcessed: true,
      orderId,
      subscriptionId: order.subscription || null,
    };
  }

  const transactionId =
    payload.TransactionId ||
    payload.transactionId ||
    payload.TransactionID ||
    order.transactionId;
  const responseCode =
    payload.ResponseCode || payload.responseCode || order.responseCode;
  const signature = payload.Signature || payload.signature;

  if (!transactionId || !responseCode) {
    throw new Error("transactionId and responseCode are required");
  }

  const check = verifyReturnSignatureDetailed({
    orderId,
    transactionId,
    responseCode,
    signature,
  });

  if (!check.valid) {
    logger.warn(
      `Kuickpay app-confirm signature mismatch for order ${orderId}. received=${signature} expected(documented)=${check.expected}`
    );

    if (!config.kuickpay.allowUnverifiedConfirm) {
      // Don't activate — but don't lose the payment either. The IPN can still
      // complete it, and the app can poll the status endpoint.
      return {
        status: order.status,
        alreadyProcessed: false,
        orderId,
        signatureVerified: false,
        message:
          "Payment received but could not be verified yet. It will be confirmed shortly.",
      };
    }
  }

  const result = await activateKuickpayOrder({
    orderId,
    transactionId,
    responseCode,
    raw: payload,
    via: "app-confirm",
    signatureVerified: check.valid,
    signatureVariant: check.variant,
  });

  const refreshed = await KuickpayOrder.findOne({ orderId });

  return {
    status: result.status,
    alreadyProcessed: result.alreadyProcessed ?? false,
    orderId,
    signatureVerified: check.valid,
    subscriptionId: refreshed?.subscription || null,
  };
};

/**
 * Lightweight polling endpoint so the app can wait for the IPN when the
 * confirm call could not activate the order on its own.
 */
const getOrderStatusForUser = async (userId: string, orderId: string) => {
  const order = await KuickpayOrder.findOne({ orderId });
  if (!order) throw new Error(`Unknown Kuickpay order: ${orderId}`);
  if (String(order.user) !== String(userId)) {
    throw new Error("This order does not belong to the current user");
  }

  return {
    orderId: order.orderId,
    status: order.status,
    transactionId: order.transactionId || null,
    responseCode: order.responseCode || null,
    activatedVia: order.activatedVia || null,
    subscriptionId: order.subscription || null,
  };
};

export const KuickpayService = {
  getAuthToken,
  createKuickpayCheckout,
  verifyAndActivate,
  confirmOrderForUser,
  getOrderStatusForUser,
};