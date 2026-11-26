export enum APP_TYPES {
  CUSTOMER = "customer",
  MERCHANT = "merchant",
}

export enum APP_PLATFORMS {
  ANDROID = "android",
  IOS = "ios",
}

// x.y.z — the same format as the version name in each app's pubspec.yaml
export const SEMVER_REGEX = /^\d+\.\d+\.\d+$/;

// Starting rows created the first time the admin page or an app asks for
// them. latestVersion matches what is live today, so no popup appears until
// an admin raises it after a new store release. iOS store links are left
// empty because the App Store IDs are not in the codebase; the apps skip the
// popup while a row has no store link.
export const DEFAULT_APP_VERSIONS = [
  {
    app: APP_TYPES.CUSTOMER,
    platform: APP_PLATFORMS.ANDROID,
    latestVersion: "1.0.2",
    minSupportedVersion: "1.0.0",
    storeUrl: "https://play.google.com/store/apps/details?id=com.miltech.miltech",
  },
  {
    app: APP_TYPES.CUSTOMER,
    platform: APP_PLATFORMS.IOS,
    latestVersion: "1.0.2",
    minSupportedVersion: "1.0.0",
    storeUrl: "",
  },
  {
    app: APP_TYPES.MERCHANT,
    platform: APP_PLATFORMS.ANDROID,
    latestVersion: "1.0.1",
    minSupportedVersion: "1.0.0",
    storeUrl: "https://play.google.com/store/apps/details?id=com.miltech.merchent",
  },
  {
    app: APP_TYPES.MERCHANT,
    platform: APP_PLATFORMS.IOS,
    latestVersion: "1.0.1",
    minSupportedVersion: "1.0.0",
    storeUrl: "",
  },
];

// Returns <0 if a<b, 0 if equal, >0 if a>b. Both must match SEMVER_REGEX.
export const compareSemver = (a: string, b: string): number => {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] - y[i];
  }
  return 0;
};
