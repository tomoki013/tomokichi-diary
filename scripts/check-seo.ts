import { RouteTable, isIndexable, instantFrom, toAbsoluteUrl } from "@tomokichi/domain";
import type { Finding } from "./lib/report.js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DIST_DIR,
  listBuiltPages,
  loadLegacyBaseline,
  loadSnapshot,
  readBuiltPage,
  report,
} from "./lib/built-site.js";

/**
 * Checks the generated HTML rather than the code that produced it, and
 * compares it against the previous site so the rewrite cannot quietly drop a
 * page out of the index (instruction §38).
 */
const SITE_URL = (process.env.PUBLIC_SITE_URL ?? "https://tomokichidiary.com").replace(/\/+$/, "");

const snapshot = loadSnapshot();
const table = new RouteTable(snapshot.routes);
const now = instantFrom(Date.now());
const pages = listBuiltPages();
const findings: Finding[] = [];

const articleById = new Map(snapshot.articles.map((article) => [article.id, article]));

interface PageSeo {
  title: string | null;
  description: string | null;
  canonical: string | null;
  robots: string | null;
  h1Count: number;
  jsonLd: string[];
  imagesWithoutAlt: number;
}

/** Titles round-trip through HTML escaping, so both sides are compared decoded. */
function decodeEntities(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function readSeo(html: string): PageSeo {
  const value = (pattern: RegExp): string | null => pattern.exec(html)?.[1]?.trim() ?? null;
  return {
    title: value(/<title[^>]*>([\s\S]*?)<\/title>/i),
    description: value(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i),
    canonical: value(/<link[^>]+rel="canonical"[^>]+href="([^"]*)"/i),
    robots: value(/<meta[^>]+name="robots"[^>]+content="([^"]*)"/i),
    h1Count: [...html.matchAll(/<h1[\s>]/gi)].length,
    jsonLd: [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map(
      (m) => m[1]!,
    ),
    // `<img alt>` is the valid, minimised spelling of `alt=""`, which is what
    // a deliberately decorative image renders as.
    imagesWithoutAlt: [...html.matchAll(/<img\b[^>]*>/gi)].filter(
      (m) => !/\salt(?:=|\s|>)/i.test(m[0]),
    ).length,
  };
}

const add = (code: Finding["code"], target: string, message?: string): void => {
  findings.push({ code, target, message, rerun: "pnpm check:seo" });
};

for (const page of pages) {
  if (page.path === "/404") continue;
  const seo = readSeo(readBuiltPage(page));
  const route = table.find(page.path);

  if (!seo.title) add("SEO_TITLE_MISSING", page.path);
  if (!seo.description) add("SEO_DESCRIPTION_MISSING", page.path);
  if (seo.h1Count === 0) add("SEO_H1_MISSING", page.path);
  if (seo.h1Count > 1) add("SEO_H1_DUPLICATE", page.path, `${seo.h1Count} h1 elements`);
  if (seo.imagesWithoutAlt > 0) {
    add("SEO_IMAGE_ALT_MISSING", page.path, `${seo.imagesWithoutAlt} image(s) without alt`);
  }

  if (!seo.canonical) add("SEO_CANONICAL_MISSING", page.path);
  else if (route) {
    const expected = toAbsoluteUrl(SITE_URL, route.path, false);
    if (seo.canonical !== expected) {
      add("SEO_CANONICAL_MISMATCH", page.path, `expected ${expected}, found ${seo.canonical}`);
    }
  }

  for (const block of seo.jsonLd) {
    try {
      JSON.parse(block);
    } catch {
      add("SEO_JSONLD_INVALID", page.path);
    }
  }
}

// Every piece of published content must actually render its own title. This
// catches a page falling through to a generic template, which still passes the
// structural checks above while serving none of its content.
const revisionById = new Map(snapshot.revisions.map((revision) => [revision.id, revision]));
for (const article of snapshot.articles) {
  const revisionId = article.publishedRevisionId;
  if (article.status !== "published" || revisionId === null) continue;

  const route = table.canonicalFor(article.kind === "page" ? "static" : "article", article.id);
  const title = revisionById.get(revisionId)?.title;
  if (!route || title === undefined) continue;

  const page = pages.find((candidate) => candidate.path === route.path);
  if (!page) continue;

  const html = readBuiltPage(page);
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? "";
  const rendered = decodeEntities(h1.replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, "")
    .trim();
  if (!rendered.includes(title.replace(/\s+/g, "").trim())) {
    add("SEO_H1_MISSING", route.path, `h1 does not render the content title "${title}"`);
  }
}

// A page the previous site allowed into the index must not become noindex.
// Preview builds turn indexing off deliberately, so the comparison only makes
// sense against a build that is meant to be indexed.
const indexableBuild = process.env.PUBLIC_INDEXABLE !== "false";
const builtByPath = new Map(pages.map((page) => [page.path, page]));
for (const legacy of indexableBuild
  ? loadLegacyBaseline<{ path: string; indexable: boolean }>("legacy-seo.json")
  : []) {
  if (!legacy.indexable) continue;
  const resolved = table.resolve(legacy.path);
  const destination = resolved.ok ? resolved.value.destination : null;
  const page = destination === null ? undefined : builtByPath.get(destination);
  if (!page) continue;

  const robots = readSeo(readBuiltPage(page)).robots ?? "";
  if (robots.toLowerCase().includes("noindex")) {
    add("SEO_NOINDEX_REGRESSION", legacy.path, `now noindex at ${destination}`);
  }
}

// Nothing in the sitemap may be noindex: Search Console reports that as an error.
const sitemapFile = join(DIST_DIR, "sitemap.xml");
const sitemapXml = existsSync(sitemapFile) ? readFileSync(sitemapFile, "utf8") : null;
const sitemapPaths = sitemapXml
  ? [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      (m) => new URL(m[1]!).pathname.replace(/\/$/, "") || "/",
    )
  : [];
for (const path of sitemapPaths) {
  const route = table.find(path);
  const article = route?.targetId ? articleById.get(route.targetId as never) : undefined;
  if (route?.noindex || (article && !isIndexable(article, now))) {
    add("SEO_SITEMAP_MISMATCH", path, "listed in the sitemap but not indexable");
  }
}

report(
  findings,
  {
    SEO: `${pages.length - new Set(findings.map((f) => f.target)).size}/${pages.length}`,
    sitemap: sitemapPaths.length,
  },
  "seo",
);
