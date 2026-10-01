import { StatusCodes } from "http-status-codes";
import stripe from "../config/stripe";
import ApiError from "../errors/ApiErrors";
import { IPackage } from "../app/modules/package/package.interface";

export type StripeProductResult = {
  productId: string;
  priceId: string;
};

/** productId/priceId stored for price-0 plans; no Stripe product exists for them. */
export const FREE_PLAN_ID = "FREE_PLAN";

/**
 * Recurring Stripe price matching the package duration
 * (e.g. "4 months" -> every 4 months). Shared by create and edit.
 */
export const createRecurringPrice = async (
  productId: string,
  price: number,
  duration: string
): Promise<string> => {
  // 🔹 Extract number from duration (e.g. "4 months" → 4)
  const durationNumber = parseInt(
    duration.toString().match(/\d+/)?.[0] || "1"
  );

  // 🔹 Detect interval type
  const interval: "month" | "year" = duration.toLowerCase().includes("year")
    ? "year"
    : "month";

  const stripePrice = await stripe.prices.create({
    product: productId,
    unit_amount: Math.round(price * 100), // cents
    currency: "usd",
    recurring: {
      interval,
      interval_count: durationNumber, // supports 4 months, 2 years, etc.
    },
  });

  return stripePrice.id;
};

export const createSubscriptionProduct = async (
  payload: Partial<IPackage>
): Promise<StripeProductResult> => {
  const { title, price, duration, description } = payload;

  // 🔹 Validation
  if (!title || price === undefined || price === null || !duration) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Title, price, and duration are required"
    );
  }

  // 🔹 Free plan handle
  if (price === 0) {
    return {
      productId: FREE_PLAN_ID,
      priceId: FREE_PLAN_ID,
    };
  }

  // 1️⃣ Create Product in Stripe
  const product = await stripe.products.create({
    name: title,
    description: description ?? "",
  });

  // 2️⃣ Create Stripe Price
  const priceId = await createRecurringPrice(product.id, price, duration);

  return {
    productId: product.id,
    priceId,
  };
};
