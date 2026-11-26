import { z } from "zod";
import {
  FEEDBACK_CATEGORY,
  FEEDBACK_PLATFORM,
  FEEDBACK_STATUS,
} from "./appFeedback.interface";

export const createAppFeedbackValidation = z.object({
  body: z
    .object({
      rating: z.number().int().min(1).max(5),
      category: z.nativeEnum(FEEDBACK_CATEGORY),
      comment: z.string().trim().max(1000).optional(),
      appVersion: z.string().trim().max(30).optional(),
      platform: z.nativeEnum(FEEDBACK_PLATFORM).optional(),
      deviceModel: z.string().trim().max(100).optional(),
    })
    .strict()
    // A bug report without a description is not useful
    .refine(
      (b) => b.category !== FEEDBACK_CATEGORY.BUG || !!b.comment?.length,
      { message: "Please describe the problem", path: ["comment"] }
    ),
});

export const updateAppFeedbackValidation = z.object({
  params: z.object({
    id: z.string().regex(/^[a-f\d]{24}$/i, "Invalid feedback id"),
  }),
  body: z
    .object({
      status: z.nativeEnum(FEEDBACK_STATUS).optional(),
      adminNote: z.string().trim().max(1000).optional(),
    })
    .strict()
    .refine((b) => b.status !== undefined || b.adminNote !== undefined, {
      message: "Nothing to update",
    }),
});
