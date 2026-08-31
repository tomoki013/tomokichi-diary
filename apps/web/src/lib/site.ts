import type { SeoConfig } from "@tomokichi/seo";

/**
 * Environment-specific configuration. Preview and staging deploys set
 * `PUBLIC_INDEXABLE=false`, which turns every page noindex and makes
 * robots.txt disallow everything — a preview must never compete with the site.
 */
const siteUrl = (process.env.PUBLIC_SITE_URL ?? "https://tomokichidiary.com").replace(/\/+$/, "");

export const seoConfig: SeoConfig = {
  siteUrl,
  siteName: "ともきちの旅行日記",
  defaultLocale: "ja",
  trailingSlash: false,
  titleSeparator: "｜",
  publisherName: "ともきちの旅行日記",
  publisherLogoUrl: `${siteUrl}/images/Introduce/introduce.jpg`,
  twitterHandle: null,
  indexable: process.env.PUBLIC_INDEXABLE !== "false",
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

/** The API origin the contact form posts to. */
export const apiUrl = (process.env.PUBLIC_API_URL ?? "https://api.tomokichidiary.com").replace(
  /\/+$/,
  "",
);

/** Public Turnstile key. Empty disables the form rather than shipping it unprotected. */
const turnstileDevelopmentSiteKey = "1x00000000000000000000AA";
export const turnstileSiteKey =
  process.env.PUBLIC_TURNSTILE_SITE_KEY || (import.meta.env.DEV ? turnstileDevelopmentSiteKey : "");

export function absoluteUrl(path: string): string {
  return `${siteUrl}${path.startsWith("/") ? path : `/${path}`}`;
}
