import { toAbsoluteUrl, type Route } from "@tomokichi/domain";
import type { SeoConfig } from "./config.js";

export interface SitemapEntry {
  readonly loc: string;
  readonly lastmod: string | null;
  readonly changefreq: "daily" | "weekly" | "monthly" | "yearly";
  readonly priority: number;
}

export interface SitemapInput {
  readonly route: Route;
  readonly lastmod: string | null;
  readonly indexable: boolean;
}

/** Anything not indexable is dropped: a sitemap entry that is noindex is a Search Console error. */
export function buildSitemap(
  config: SeoConfig,
  inputs: readonly SitemapInput[],
): readonly SitemapEntry[] {
  return inputs
    .filter(
      (input) =>
        input.indexable &&
        !input.route.noindex &&
        input.route.targetType !== "redirect" &&
        input.route.isCanonical,
    )
    .map((input) => ({
      loc: toAbsoluteUrl(config.siteUrl, input.route.path, config.trailingSlash),
      lastmod: input.lastmod,
      changefreq: input.route.targetType === "article" ? ("monthly" as const) : ("weekly" as const),
      priority: input.route.path === "/" ? 1 : input.route.targetType === "article" ? 0.7 : 0.5,
    }));
}

export function renderSitemapXml(entries: readonly SitemapEntry[]): string {
  const urls = entries
    .map((entry) =>
      [
        "  <url>",
        `    <loc>${escapeXml(entry.loc)}</loc>`,
        entry.lastmod ? `    <lastmod>${entry.lastmod}</lastmod>` : null,
        `    <changefreq>${entry.changefreq}</changefreq>`,
        `    <priority>${entry.priority}</priority>`,
        "  </url>",
      ]
        .filter((line) => line !== null)
        .join("\n"),
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export interface FeedItem {
  readonly title: string;
  readonly description: string;
  readonly route: Route;
  readonly publishedAt: string;
}

export function renderRssXml(config: SeoConfig, items: readonly FeedItem[]): string {
  const home = `${config.siteUrl.replace(/\/+$/, "")}/`;
  const entries = items
    .map((item) => {
      const link = toAbsoluteUrl(config.siteUrl, item.route.path, config.trailingSlash);
      return [
        "    <item>",
        `      <title>${escapeXml(item.title)}</title>`,
        `      <link>${escapeXml(link)}</link>`,
        `      <guid isPermaLink="true">${escapeXml(link)}</guid>`,
        `      <pubDate>${new Date(item.publishedAt).toUTCString()}</pubDate>`,
        `      <description>${escapeXml(item.description)}</description>`,
        "    </item>",
      ].join("\n");
    })
    .join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    "  <channel>",
    `    <title>${escapeXml(config.siteName)}</title>`,
    `    <link>${escapeXml(home)}</link>`,
    `    <description>${escapeXml(config.siteName)}</description>`,
    "    <language>ja</language>",
    entries,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}

export interface RobotsOptions {
  readonly disallow?: readonly string[];
}

/** Non-production environments emit a blanket disallow so previews cannot be indexed. */
export function renderRobotsTxt(config: SeoConfig, options: RobotsOptions = {}): string {
  if (!config.indexable) return "User-agent: *\nDisallow: /\n";
  const lines = [
    "User-agent: *",
    "Allow: /",
    ...(options.disallow ?? []).map((path) => `Disallow: ${path}`),
  ];
  lines.push("", `Sitemap: ${config.siteUrl.replace(/\/+$/, "")}/sitemap.xml`, "");
  return lines.join("\n");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
