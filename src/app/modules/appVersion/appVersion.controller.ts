import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { AuditService } from "../auditLog/audit.service";
import { AppVersionService } from "./appVersion.service";

const checkVersion = catchAsync(async (req: Request, res: Response) => {
  const { app, platform } = req.query as { app: string; platform: string };
  const data = await AppVersionService.checkVersion(app, platform);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "App version fetched successfully",
    data,
  });
});

const getAll = catchAsync(async (_req: Request, res: Response) => {
  const data = await AppVersionService.getAll();

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "App versions fetched successfully",
    data,
  });
});

const update = catchAsync(async (req: Request, res: Response) => {
  const adminId = (req.user as any)?._id?.toString();
  const { before, after } = await AppVersionService.update(
    req.params.id,
    req.body,
    adminId
  );

  const changes: string[] = [];
  if (before.latestVersion !== after?.latestVersion) {
    changes.push(`latest ${before.latestVersion} → ${after?.latestVersion}`);
  }
  if (before.minSupportedVersion !== after?.minSupportedVersion) {
    changes.push(
      `min supported ${before.minSupportedVersion} → ${after?.minSupportedVersion}`
    );
  }
  if (before.storeUrl !== after?.storeUrl) changes.push("store URL changed");
  if ((before.releaseNotes ?? "") !== (after?.releaseNotes ?? "")) {
    changes.push("release notes changed");
  }

  if (adminId) {
    await AuditService.createLog(
      adminId,
      "UPDATE_APP_VERSION",
      `${before.app} ${before.platform}: ${
        changes.length ? changes.join(", ") : "no changes"
      }`
    );
  }

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "App version updated successfully",
    data: after,
  });
});

export const AppVersionController = { checkVersion, getAll, update };
