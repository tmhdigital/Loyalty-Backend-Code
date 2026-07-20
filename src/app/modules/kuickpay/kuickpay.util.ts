import crypto from "crypto";
import config from "../../../config";

/**
 * Resolve which Kuickpay host to use based on KUICKPAY_ENV.
 * Sandbox host is documented in the Merchant Implementation Guide.
 * Production host must be supplied by Kuickpay/Bank Alfalah before go-live.
 */
export const getKuickpayBaseUrl = (): string => {
  const isProduction = config.kuickpay.env === "production";

  if (isProduction) {
    if (!config.kuickpay.productionBaseUrl) {
      throw new Error(
        "KUICKPAY_PRODUCTION_BASE_URL is not configured. Set it before switching KUICKPAY_ENV=production."
      );
    }
    return config.kuickpay.productionBaseUrl;
  }

  return config.kuickpay.sandboxBaseUrl;
};

export const getKuickpayTokenUrl = () => `${getKuickpayBaseUrl()}/api/KPToken`;
export const getKuickpayRedirectionUrl = () =>
  `${getKuickpayBaseUrl()}/api/Redirection`;

/**
 * Signature sent WITH the redirection form:
 * MD5(InstitutionID + OrderID + Amount + KuickpaySecuredKey)
 */
export const buildRedirectionSignature = (
  institutionId: string,
  orderId: string,
  amount: string,
  securedKey: string
): string => {
  const raw = `${institutionId}${orderId}${amount}${securedKey}`;
  return crypto.createHash("md5").update(raw).digest("hex");
};

/**
 * Signature Kuickpay sends BACK on the success/failure redirect & IPN:
 * MD5(OrderID & TransactionID & KuickpaySecuredKey & ResponseCode)
 * The guide uses "&" literally as a separator, not URL query concatenation.
 */
export const buildReturnSignature = (
  orderId: string,
  transactionId: string,
  securedKey: string,
  responseCode: string
): string => {
  const raw = `${orderId}&${transactionId}&${securedKey}&${responseCode}`;
  return crypto.createHash("md5").update(raw).digest("hex");
};

export const verifyReturnSignature = (params: {
  orderId: string;
  transactionId: string;
  responseCode: string;
  signature: string;
}): boolean => {
  const { orderId, transactionId, responseCode, signature } = params;
  if (!orderId || !transactionId || !responseCode || !signature) return false;

  const expected = buildReturnSignature(
    orderId,
    transactionId,
    config.kuickpay.securedKey as string,
    responseCode
  );

  // Constant-time compare to avoid timing attacks
  const a = Buffer.from(expected.toLowerCase());
  const b = Buffer.from(String(signature).toLowerCase());
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

export const KUICKPAY_RESPONSE_CODE_SUCCESS = "00";

/**
 * Kuickpay (like most PK local payment/bank gateways) expects the customer's
 * mobile number in LOCAL format: 03XXXXXXXXX (11 digits, leading 0).
 * Our users may be stored in E.164 (+923XXXXXXXXX) or without the '+'.
 * This normalizes any of those into the local format Kuickpay expects.
 */
export const toKuickpayLocalMobile = (raw: string | undefined | null): string => {
  if (!raw) return "";

  // Strip anything that isn't a digit
  let digits = raw.replace(/\D/g, "");

  // +923035540807 / 923035540807  -> 03035540807
  if (digits.startsWith("92") && digits.length === 12) {
    digits = "0" + digits.slice(2);
  }

  // Already local (03035540807, 11 digits) -> leave as-is
  // Anything else unexpected is passed through unchanged so we don't silently
  // corrupt a number we don't recognize the shape of.
  return digits;
};