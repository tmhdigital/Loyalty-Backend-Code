import { z } from "zod";
import { Types } from "mongoose";

const addRecentViewedZodSchema = z.object({
  body: z.object({
    promotionId: z
      .string({ required_error: "promotionId is required" })
      .refine((id) => Types.ObjectId.isValid(id), "Invalid promotion id"),
  }),
});

export const RecentViewedPromotionValidations = {
  addRecentViewedZodSchema,
};
