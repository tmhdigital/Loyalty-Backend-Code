import { StatusCodes } from "http-status-codes";
import ApiError from "../errors/ApiErrors";

/**
 * Merchant "website" field: website ya social media profile link.
 *
 * User sirf `rewaldo.com` ya `instagram.com/rewaldo` likhta hai, system
 * khud `https://` lagata hai. `www` khud add nahi hota (subdomains toot jate
 * hain), lekin agar user ne likha ho to rehta hai.
 *
 * Yahi logic business dashboard (src/utils/websiteUrl.js) aur merchant app
 * (lib/utils/website_url.dart) mein bhi hai. Rule badlein to teeno jagah badlein.
 */

export type WebsiteUrlResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

export const WEBSITE_URL_MESSAGES = {
  required: "Please enter your website or social media link.",
  spaces: "The link must not contain spaces.",
  tooLong: "The link is too long.",
  invalid:
    "Please enter a valid website or social media link, for example rewaldo.com.",
  profileMissing:
    "Please enter the full profile link, for example instagram.com/yourbusiness.",
};

const MAX_LENGTH = 2048;

// Social domains jahan sirf domain kaafi nahi, profile path zaroori hai.
const SOCIAL_DOMAINS = [
  "instagram.com",
  "facebook.com",
  "fb.com",
  "tiktok.com",
  "x.com",
  "twitter.com",
  "linkedin.com",
  "youtube.com",
  "snapchat.com",
  "pinterest.com",
  "threads.net",
  "threads.com",
];

// `https://`, `http://`, `https:/`, `htps://`, `https//`, `://`, `//` waghera.
const PROTOCOL_PREFIX = /^(?:h?t{1,2}ps?)?(?::\/{0,3}|\/{2,3})/i;

// Koi aur scheme (mailto:, javascript:, data: ...). `host:port` ko chhor kar.
const OTHER_SCHEME = /^[a-z][a-z0-9+.-]*:(?!\d)/i;

// Labels + TLD sirf letters (ya punycode). IP aur localhost is se reject.
const HOSTNAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

const isSocialDomain = (host: string) =>
  SOCIAL_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));

export const normalizeWebsiteUrl = (raw: unknown): WebsiteUrlResult => {
  if (typeof raw !== "string") {
    return { ok: false, error: WEBSITE_URL_MESSAGES.required };
  }

  let value = raw.trim();
  if (!value) return { ok: false, error: WEBSITE_URL_MESSAGES.required };
  if (/\s/.test(value)) return { ok: false, error: WEBSITE_URL_MESSAGES.spaces };
  if (value.length > MAX_LENGTH) {
    return { ok: false, error: WEBSITE_URL_MESSAGES.tooLong };
  }
  // `@handle` aur backslash: teeno platforms par ek jaisa reject (Dart parity).
  if (value.startsWith("@")) {
    return { ok: false, error: WEBSITE_URL_MESSAGES.profileMissing };
  }
  if (value.includes("\\")) {
    return { ok: false, error: WEBSITE_URL_MESSAGES.invalid };
  }

  // `https://https://...` jaise double prefix bhi hat jayein.
  while (PROTOCOL_PREFIX.test(value)) {
    value = value.replace(PROTOCOL_PREFIX, "");
  }
  if (!value || OTHER_SCHEME.test(value)) {
    return { ok: false, error: WEBSITE_URL_MESSAGES.invalid };
  }

  // Non-English domain Dart mein support nahi, is liye yahan bhi reject.
  const authority = value.split(/[/?#]/)[0];
  if (/[^\x21-\x7e]/.test(authority)) {
    return { ok: false, error: WEBSITE_URL_MESSAGES.invalid };
  }

  let url: URL;
  try {
    url = new URL(`https://${value}`);
  } catch {
    return { ok: false, error: WEBSITE_URL_MESSAGES.invalid };
  }

  const host = url.hostname.toLowerCase();
  if (url.username || url.password || !HOSTNAME.test(host)) {
    return { ok: false, error: WEBSITE_URL_MESSAGES.invalid };
  }

  const hasPath = url.pathname !== "/" && url.pathname !== "";
  if (isSocialDomain(host) && !hasPath) {
    return { ok: false, error: WEBSITE_URL_MESSAGES.profileMissing };
  }

  // Domain lowercase, path waisa hi (kuch usernames case-sensitive hain).
  let normalized = `https://${host}${url.port ? `:${url.port}` : ""}${url.pathname}${url.search}${url.hash}`;
  if (!url.search && !url.hash) normalized = normalized.replace(/\/+$/, "");

  if (normalized.length > MAX_LENGTH) {
    return { ok: false, error: WEBSITE_URL_MESSAGES.tooLong };
  }
  return { ok: true, url: normalized };
};

/**
 * Payload mein `website` ho to saaf karke wapas likhta hai, ghalat ho to 400.
 * `allowEmpty`: admin raste jahan khali value ka matlab "kuch na badlo" hai.
 */
export const applyWebsiteToPayload = (
  payload: Record<string, any>,
  { allowEmpty = false }: { allowEmpty?: boolean } = {}
) => {
  if (!payload || payload.website === undefined) return;

  const isEmpty =
    payload.website === null ||
    (typeof payload.website === "string" && !payload.website.trim());
  if (allowEmpty && isEmpty) {
    delete payload.website;
    return;
  }

  const result = normalizeWebsiteUrl(payload.website);
  if (!result.ok) throw new ApiError(StatusCodes.BAD_REQUEST, result.error);
  payload.website = result.url;
};
