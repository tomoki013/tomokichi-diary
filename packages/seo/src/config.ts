import type { Locale } from "@tomokichi/domain";

/** Environment-specific values; never hard-coded into a page (instruction §55). */
export interface SeoConfig {
  readonly siteUrl: string;
  readonly siteName: string;
  /** The home page's own title. Every other page gets the site name appended. */
  readonly homeTitle?: string;
  readonly defaultLocale: Locale;
  readonly trailingSlash: boolean;
  readonly titleSeparator: string;
  readonly publisherName: string;
  readonly publisherLogoUrl: string;
  readonly twitterHandle: string | null;
  /** Preview and staging must never be indexed. */
  readonly indexable: boolean;
}

export const DEFAULT_SEO_CONFIG: SeoConfig = {
  siteUrl: "https://tomokichidiary.com",
  siteName: "ともきちの旅行日記",
  homeTitle: "ともきちの旅行日記｜Tomokichi Diary",
  defaultLocale: "ja",
  trailingSlash: false,
  titleSeparator: "｜",
  publisherName: "ともきちの旅行日記",
  publisherLogoUrl: "https://tomokichidiary.com/images/logo.png",
  twitterHandle: null,
  indexable: true,
};
