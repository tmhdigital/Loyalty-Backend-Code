import express from "express";
import rateLimit from "express-rate-limit";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import { USER_ROLES } from "../../../enums/user";
import { AppFeedbackController } from "./appFeedback.controller";
import {
  createAppFeedbackValidation,
  updateAppFeedbackValidation,
} from "./appFeedback.validation";

const router = express.Router();

// Anti-spam: max 5 feedback submissions per customer per hour.
// Runs after auth(), so it is keyed by user id, not IP.
const feedbackLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `app-feedback:${(req.user as any)?._id}`,
  message: {
    success: false,
    message: "You have sent a lot of feedback. Please try again later.",
  },
});

// Customer submits app feedback
router.post(
  "/",
  auth(USER_ROLES.USER),
  feedbackLimiter,
  validateRequest(createAppFeedbackValidation),
  AppFeedbackController.createFeedback
);

// Admin: list feedback with filters, pagination and summary
router.get(
  "/",
  auth(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN, USER_ROLES.VIEW_ADMIN),
  AppFeedbackController.getAllFeedback
);

// Admin: change status / add note
router.patch(
  "/:id",
  auth(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN),
  validateRequest(updateAppFeedbackValidation),
  AppFeedbackController.updateFeedback
);

export const AppFeedbackRoutes = router;
