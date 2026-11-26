import {
  checkAppVersionValidation,
  updateAppVersionValidation,
} from "../app/modules/appVersion/appVersion.validation";
import { compareSemver } from "../app/modules/appVersion/appVersion.constants";

const id = "64b7f0c2a1b2c3d4e5f60718";
const update = (body: Record<string, unknown>) =>
  updateAppVersionValidation.safeParse({ params: { id }, body });

const valid = {
  latestVersion: "1.0.3",
  minSupportedVersion: "1.0.0",
  storeUrl: "https://play.google.com/store/apps/details?id=com.example",
};

describe("compareSemver", () => {
  it("compares each part as a number", () => {
    expect(compareSemver("1.0.10", "1.0.9")).toBeGreaterThan(0);
    expect(compareSemver("1.2.0", "1.10.0")).toBeLessThan(0);
    expect(compareSemver("2.0.0", "1.99.99")).toBeGreaterThan(0);
    expect(compareSemver("1.0.3", "1.0.3")).toBe(0);
  });
});

describe("App version check validation", () => {
  it("accepts a known app and platform", () => {
    expect(
      checkAppVersionValidation.safeParse({
        query: { app: "customer", platform: "ios" },
      }).success
    ).toBe(true);
  });

  it("rejects an unknown app or platform", () => {
    expect(
      checkAppVersionValidation.safeParse({
        query: { app: "admin", platform: "android" },
      }).success
    ).toBe(false);
    expect(
      checkAppVersionValidation.safeParse({
        query: { app: "customer", platform: "web" },
      }).success
    ).toBe(false);
  });
});

describe("App version update validation", () => {
  it("accepts a valid update", () => {
    expect(update(valid).success).toBe(true);
  });

  it("accepts an empty store URL and min equal to latest", () => {
    expect(
      update({ ...valid, storeUrl: "", minSupportedVersion: "1.0.3" }).success
    ).toBe(true);
  });

  it("rejects versions that are not x.y.z", () => {
    expect(update({ ...valid, latestVersion: "1.0" }).success).toBe(false);
    expect(update({ ...valid, latestVersion: "v1.0.3" }).success).toBe(false);
    expect(update({ ...valid, latestVersion: "1.0.3+14" }).success).toBe(false);
  });

  it("rejects min supported higher than latest", () => {
    expect(
      update({ ...valid, minSupportedVersion: "1.0.10", latestVersion: "1.0.9" })
        .success
    ).toBe(false);
  });

  it("rejects a non-https store URL", () => {
    expect(
      update({ ...valid, storeUrl: "http://play.google.com/x" }).success
    ).toBe(false);
    expect(update({ ...valid, storeUrl: "not a url" }).success).toBe(false);
  });

  it("rejects changing app or platform", () => {
    expect(update({ ...valid, app: "merchant" }).success).toBe(false);
  });
});
