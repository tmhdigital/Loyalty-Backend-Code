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

const md5 = (raw: string) => crypto.createHash("md5").update(raw).digest("hex");

const safeEqual = (expected: string, received: string): boolean => {
  const a = Buffer.from(expected.toLowerCase());
  const b = Buffer.from(String(received).toLowerCase());
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

/**
 * Kuickpay's guide documents ONE return-signature format, but different
 * institutions/versions of their checkout have been seen sending a couple of
 * slightly different concatenations. Every candidate below still requires the
 * secured key, so accepting any of them does not weaken security — it only
 * stops a formatting mismatch from silently killing every payment.
 *
 * Returns which variant matched (useful for logs) or null when none did.
 */
export const verifyReturnSignatureDetailed = (params: {
  orderId: string;
  transactionId: string;
  responseCode: string;
  signature: string;
}): { valid: boolean; variant: string | null; expected: string } => {
  const { orderId, transactionId, responseCode, signature } = params;

  const securedKey = config.kuickpay.securedKey as string;
  const institutionId = config.kuickpay.institutionId as string;

  const documented = buildReturnSignature(
    orderId,
    transactionId,
    securedKey,
    responseCode
  );

  if (!orderId || !transactionId || !responseCode || !signature) {
    return { valid: false, variant: null, expected: documented };
  }

  const candidates: Array<{ name: string; value: string }> = [
    // Documented: MD5(OrderID & TransactionID & SecuredKey & ResponseCode)
    { name: "documented", value: documented },
    // Same fields, no separators
    {
      name: "no-separator",
      value: md5(`${orderId}${transactionId}${securedKey}${responseCode}`),
    },
    // Some institutions prefix the InstitutionID
    {
      name: "with-institution",
      value: md5(
        `${institutionId}&${orderId}&${transactionId}&${securedKey}&${responseCode}`
      ),
    },
    {
      name: "with-institution-no-separator",
      value: md5(
        `${institutionId}${orderId}${transactionId}${securedKey}${responseCode}`
      ),
    },
  ];

  for (const candidate of candidates) {
    if (safeEqual(candidate.value, signature)) {
      return { valid: true, variant: candidate.name, expected: candidate.value };
    }
  }

  return { valid: false, variant: null, expected: documented };
};

export const verifyReturnSignature = (params: {
  orderId: string;
  transactionId: string;
  responseCode: string;
  signature: string;
}): boolean => verifyReturnSignatureDetailed(params).valid;

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