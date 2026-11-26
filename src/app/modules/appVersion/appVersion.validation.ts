import { z } from "zod";
import {
  APP_PLATFORMS,
  APP_TYPES,
  SEMVER_REGEX,
  compareSemver,
} from "./appVersion.constants";

const semver = (field: string) =>
  z
    .string({ required_error: `${field} is required` })
    .trim()
    .regex(SEMVER_REGEX, `${field} must look like 1.0.3`);

// Public check used by the mobile apps on launch
export const checkAppVersionValidation = z.object({
  query: z.object({
    app: z.nativeEnum(APP_TYPES, { required_error: "app is required" }),
    platform: z.nativeEnum(APP_PLATFORMS, {
      required_error: "platform is required",
    }),
  }),
});

// Admin edit of one row. app/platform cannot be changed.
export const updateAppVersionValidation = z.object({
  params: z.object({
    id: z.string().regex(/^[a-f\d]{24}$/i, "Invalid id"),
  }),
  body: z
    .object({
      latestVersion: semver("Latest version"),
      minSupportedVersion: semver("Minimum supported version"),
      storeUrl: z
        .string()
        .trim()
        .url("Store URL must be a valid link")
        .refine((u) => u.startsWith("https://"), "Store URL must use https")
        .or(z.literal("")),
      releaseNotes: z
        .string()
        .trim()
        .max(500, "Release notes can be at most 500 characters")
        .optional(),
    })
    .strict()
    .refine(
      (b) => compareSemver(b.minSupportedVersion, b.latestVersion) <= 0,
      {
        message:
          "Minimum supported version cannot be higher than the latest version",
        path: ["minSupportedVersion"],
      }
    ),
});
