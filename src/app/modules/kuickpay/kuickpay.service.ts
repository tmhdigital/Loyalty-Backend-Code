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
  verifyReturnSignature,
} from "./kuickpay.util";
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

  const userPoints = user.points || 0;
  let finalPrice = pkg.price;
  const maxDiscount = pkg.price * 0.8;
  const usablePoints = Math.min(userPoints, maxDiscount);
  if (usablePoints > 0) {
    finalPrice -= usablePoints;
  }

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
// 3) Activate subscription once payment is confirmed (used by BOTH return + IPN,
//    guarded to be idempotent since both can fire for the same order)
// =========================
const activateKuickpayOrder = async (params: {
  orderId: string;
  transactionId: string;
  responseCode: string;
  raw: Record<string, unknown>;
  via: "return" | "ipn";
}): Promise<{ success: boolean; alreadyProcessed?: boolean }> => {
  const { orderId, transactionId, responseCode, raw, via } = params;

  const order = await KuickpayOrder.findOne({ orderId });
  if (!order) {
    throw new Error(`Unknown Kuickpay order: ${orderId}`);
  }

  const isSuccess = responseCode === KUICKPAY_RESPONSE_CODE_SUCCESS;

  if (order.status === "completed") {
    return { success: true, alreadyProcessed: true };
  }

  if (via === "return") {
    order.rawReturn = raw;
  } else {
    order.rawIpn = raw;
  }
  order.transactionId = transactionId;
  order.responseCode = responseCode;

  if (!isSuccess) {
    order.status = "failed";
    await order.save();
    return { success: false };
  }

  order.status = "completed";
  await order.save();

  const pkg = await Package.findById(order.package);
  if (!pkg) throw new Error("Package not found while activating subscription");

  // Prevent double-creation if both return + IPN race each other
  const existingSub = await Subscription.findOne({ subscriptionId: transactionId });
  if (existingSub) {
    return { success: true, alreadyProcessed: true };
  }

  await Subscription.create({
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

  await User.findByIdAndUpdate(order.user, {
    subscription: "active",
    paymentStatus: "paid",
  });

  return { success: true };
};

const verifyAndActivate = async (
  query: Record<string, any>,
  via: "return" | "ipn"
) => {
  const orderId = query.OrderId || query.orderId;
  const transactionId = query.TransactionId || query.transactionId;
  const responseCode = query.ResponseCode || query.responseCode;
  const signature = query.Signature || query.signature;

  const validSignature = verifyReturnSignature({
    orderId,
    transactionId,
    responseCode,
    signature,
  });

  if (!validSignature) {
    throw new Error("Invalid Kuickpay signature");
  }

  return activateKuickpayOrder({
    orderId,
    transactionId,
    responseCode,
    raw: query,
    via,
  });
};

export const KuickpayService = {
  getAuthToken,
  createKuickpayCheckout,
  verifyAndActivate,
};