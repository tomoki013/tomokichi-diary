import {
  toAbsoluteUrl,
  toPlainText,
  truncate,
  type Article,
  type ArticleRevision,
  type Route,
} from "@tomokichi/domain";
import type { SeoConfig } from "./config.js";

const MAX_DESCRIPTION_LENGTH = 120;

export interface PageMetadata {
  readonly title: string;
  readonly description: string;
  readonly canonical: string;
  readonly robots: string;
  readonly openGraph: Readonly<Record<string, string>>;
  readonly twitter: Readonly<Record<string, string>>;
}

export interface ArticleMetadataInput {
  readonly article: Article;
  readonly revision: ArticleRevision;
  readonly route: Route;
  readonly coverImageUrl: string | null;
  readonly authorName: string | null;
}

export function buildCanonical(config: SeoConfig, route: Route): string {
  return toAbsoluteUrl(config.siteUrl, route.path, config.trailingSlash);
}

/** Overrides win; otherwise the title is derived, so most articles store no SEO row at all. */
export function buildTitle(config: SeoConfig, pageTitle: string, override?: string | null): string {
  const title = override?.trim() || pageTitle.trim();
  /* The home page names the site once, in its own form; everywhere else the
     page title carries the site name as a suffix. */
  if (title === config.siteName) return config.homeTitle?.trim() || title;
  return `${title}${config.titleSeparator}${config.siteName}`;
}

export function buildDescription(revision: ArticleRevision): string {
  const explicit = revision.seoDescriptionOverride?.trim() || revision.summary.trim();
  const source = explicit === "" ? toPlainText(revision.bodyMarkdown) : explicit;
  return truncate(source, MAX_DESCRIPTION_LENGTH);
}

export function buildRobots(config: SeoConfig, noindex: boolean): string {
  return !config.indexable || noindex ? "noindex, nofollow" : "index, follow";
}

export function buildArticleMetadata(config: SeoConfig, input: ArticleMetadataInput): PageMetadata {
  const { article, revision, route, coverImageUrl } = input;
  const canonical = buildCanonical(config, route);
  const title = buildTitle(config, revision.title, revision.seoTitleOverride);
  const description = buildDescription(revision);

  const openGraph: Record<string, string> = {
    "og:type": "article",
    "og:title": revision.seoTitleOverride?.trim() || revision.title,
    "og:description": description,
    "og:url": canonical,
    "og:site_name": config.siteName,
    "og:locale": article.locale === "ja" ? "ja_JP" : "en_US",
  };
  if (coverImageUrl) openGraph["og:image"] = coverImageUrl;
  if (article.publishedAt) openGraph["article:published_time"] = article.publishedAt;
  openGraph["article:modified_time"] = article.updatedAt;
  if (input.authorName) openGraph["article:author"] = input.authorName;

  const twitter: Record<string, string> = {
    "twitter:card": coverImageUrl ? "summary_large_image" : "summary",
    "twitter:title": openGraph["og:title"]!,
    "twitter:description": description,
  };
  if (coverImageUrl) twitter["twitter:image"] = coverImageUrl;
  if (config.twitterHandle) twitter["twitter:site"] = config.twitterHandle;

  return {
    title,
    description,
    canonical,
    robots: buildRobots(config, article.noindex),
    openGraph,
    twitter,
  };
}

export interface SimplePageInput {
  readonly title: string;
  readonly description: string;
  readonly route: Route;
  readonly imageUrl?: string | null;
  readonly noindex?: boolean;
}

export function buildPageMetadata(config: SeoConfig, input: SimplePageInput): PageMetadata {
  const canonical = buildCanonical(config, input.route);
  const description = truncate(input.description, MAX_DESCRIPTION_LENGTH);
  const openGraph: Record<string, string> = {
    "og:type": "website",
    "og:title": input.title,
    "og:description": description,
    "og:url": canonical,
    "og:site_name": config.siteName,
  };
  if (input.imageUrl) openGraph["og:image"] = input.imageUrl;

  const twitter: Record<string, string> = {
    "twitter:card": input.imageUrl ? "summary_large_image" : "summary",
    "twitter:title": input.title,
    "twitter:description": description,
  };
  if (config.twitterHandle) twitter["twitter:site"] = config.twitterHandle;

  return {
    title: buildTitle(config, input.title),
    description,
    canonical,
    robots: buildRobots(config, input.noindex ?? false),
    openGraph,
    twitter,
  };
}

export interface AlternateLink {
  readonly hreflang: string;
  readonly href: string;
}

/** Emitted only when a translation actually exists; a lone page gets no hreflang. */
export function buildHreflang(
  config: SeoConfig,
  routes: readonly Route[],
): readonly AlternateLink[] {
  if (routes.length < 2) return [];
  const links = routes.map((route) => ({
    hreflang: route.locale,
    href: toAbsoluteUrl(config.siteUrl, route.path, config.trailingSlash),
  }));
  const fallback = routes.find((r) => r.locale === config.defaultLocale);
  return fallback
    ? [
        ...links,
        {
          hreflang: "x-default",
          href: toAbsoluteUrl(config.siteUrl, fallback.path, config.trailingSlash),
        },
      ]
    : links;
}
