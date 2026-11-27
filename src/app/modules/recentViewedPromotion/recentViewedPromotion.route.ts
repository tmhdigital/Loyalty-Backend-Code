import express from "express";

import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";

import { RecentViewedPromotionController } from "./recentViewedPromotion.controller";
import { RecentViewedPromotionValidations } from "./recentViewedPromotion.validation";

const router = express.Router();

router.post(
  "/",
  auth(),
  validateRequest(RecentViewedPromotionValidations.addRecentViewedZodSchema),
  RecentViewedPromotionController.addRecentViewed
);

router.get("/", auth(), RecentViewedPromotionController.getRecentViewed);

export const RecentViewedPromotionRoutes = router;
