import type { SeoConfig } from "@tomokichi/seo";

/**
 * Environment-specific configuration. Production explicitly sets
 * `PUBLIC_INDEXABLE=true`; every other build is noindex by default so a
 * preview cannot accidentally compete with the site if its environment is
 * incomplete.
 */
const siteUrl = (process.env.PUBLIC_SITE_URL ?? "https://tomokichidiary.com").replace(/\/+$/, "");

export const seoConfig: SeoConfig = {
  siteUrl,
  siteName: "ともきちの旅行日記",
  homeTitle: "ともきちの旅行日記｜Tomokichi Diary",
  defaultLocale: "ja",
  trailingSlash: false,
  titleSeparator: "｜",
  publisherName: "ともきちの旅行日記",
  publisherLogoUrl: `${siteUrl}/images/Introduce/introduce.jpg`,
  twitterHandle: null,
  indexable: process.env.PUBLIC_INDEXABLE === "true",
};

export const siteDescription =
  "実際に旅した体験をもとに、旅行記・観光や移動のガイドをまとめた個人旅行ブログです。空港から市内へのアクセスや現地の交通、費用の記録など、旅の計画に役立つ一次情報を発信しています。";

/**
 * All media is served from the R2 bucket behind its own domain, so the site
 * Worker ships only HTML and CSS. The previous site's `/images/...` URLs are
 * kept alive by a redirect in the build output.
 */
export const mediaBaseUrl = (
  process.env.PUBLIC_MEDIA_URL ?? "https://media.tomokichidiary.com"
).replace(/\/+$/, "");

export function mediaUrl(storageKey: string): string {
  return `${mediaBaseUrl}/${storageKey.replace(/^\/+/, "")}`;
}

/**
 * GA4 property carried over from the previous site, so the history continues
 * across the cutover. Measurement only runs on these hostnames: a workers.dev
 * preview, a local build and Lighthouse all ship the same HTML but must not
 * report into the production property.
 */
export const gaMeasurementId = process.env.PUBLIC_GA_MEASUREMENT_ID ?? "G-BZJ1EDMYTZ";
export const analyticsHostnames = ["tomokichidiary.com", "www.tomokichidiary.com"];

/** AdSense publisher (the same one `public/ads.txt` authorises). No ad script is loaded. */
export const adsenseClient = "ca-pub-8687520805381056";

/** The API origin the contact form posts to. */
export const apiUrl = (process.env.PUBLIC_API_URL ?? "https://api.tomokichidiary.com").replace(
  /\/+$/,
  "",
);

/**
 * Public Turnstile key (widget `tomokichi-diary-contact`, which allows
 * tomokichidiary.com and the workers.dev preview). A site key is public by
 * design, so it lives here rather than only in the release environment: when it
 * was env-only, a build that forgot the variable shipped without the form.
 * `PUBLIC_TURNSTILE_SITE_KEY=""` still disables the form; dev uses Cloudflare's
 * always-pass test key.
 */
const turnstileDevelopmentSiteKey = "1x00000000000000000000AA";
const turnstileProductionSiteKey = "0x4AAAAAAEho0EBgaV1Hn_iT";
export const turnstileSiteKey =
  process.env.PUBLIC_TURNSTILE_SITE_KEY ??
  (import.meta.env.DEV ? turnstileDevelopmentSiteKey : turnstileProductionSiteKey);

export function absoluteUrl(path: string): string {
  return `${siteUrl}${path.startsWith("/") ? path : `/${path}`}`;
}
