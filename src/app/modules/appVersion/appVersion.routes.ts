import express from "express";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import { USER_ROLES } from "../../../enums/user";
import { AppVersionController } from "./appVersion.controller";
import {
  checkAppVersionValidation,
  updateAppVersionValidation,
} from "./appVersion.validation";

const router = express.Router();

// Public: called by the mobile apps on launch, before login
router.get(
  "/check",
  validateRequest(checkAppVersionValidation),
  AppVersionController.checkVersion
);

// Admin: list all app/platform rows
router.get(
  "/",
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.VIEW_ADMIN),
  AppVersionController.getAll
);

// Admin: edit one row
router.patch(
  "/:id",
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  validateRequest(updateAppVersionValidation),
  AppVersionController.update
);

export const AppVersionRoutes = router;
