import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Records what the current site publishes, before any of it is rewritten.
 *
 * Routes come from two independent sources — the legacy repository and the live
 * sitemap — because the sitemap deliberately omits noindex pages that must
 * still keep resolving after the rewrite (instruction §2, §30).
 */
const LEGACY_REPO = process.env.LEGACY_REPO ?? join(process.cwd(), "..", "travel-diary");
const SITE = (process.env.LEGACY_SITE ?? "https://tomokichidiary.com").replace(/\/+$/, "");
const OUT_DIR = join(process.cwd(), "migration");
const CONCURRENCY = Number(process.env.BASELINE_CONCURRENCY ?? 2);
const DELAY_MS = Number(process.env.BASELINE_DELAY_MS ?? 250);
const MAX_ATTEMPTS = 4;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface RouteRecord {
  path: string;
  source: "sitemap" | "repository" | "both";
  status: number | null;
  inSitemap: boolean;
}

interface SeoRecord {
  path: string;
  status: number | null;
  title: string | null;
  description: string | null;
  canonical: string | null;
  robots: string | null;
  indexable: boolean;
  h1: string[];
  jsonLdTypes: string[];
  ogTitle: string | null;
  ogImage: string | null;
}

interface LinkRecord {
  path: string;
  internalLinks: string[];
}

interface MediaRecord {
  path: string;
  images: { src: string; alt: string | null }[];
}

function routesFromRepository(): string[] {
  const paths = new Set<string>(["/"]);

  for (const file of readdirSync(join(LEGACY_REPO, "posts"))) {
    if (file.endsWith(".md")) paths.add(`/posts/${file.replace(/\.md$/, "")}`);
  }

  // The data files are TypeScript, so slugs are read textually rather than by
  // importing the legacy app (which would drag in its whole dependency tree).
  const slugsIn = (relativePath: string): string[] => {
    const source = readFileSync(join(LEGACY_REPO, relativePath), "utf8");
    return [...source.matchAll(/slug:\s*"([^"]+)"/g)].map((m) => m[1]!);
  };
  for (const slug of slugsIn("src/data/region.ts")) paths.add(`/destination/${slug}`);
  for (const slug of slugsIn("src/data/series.ts")) paths.add(`/series/${slug}`);

  const journey = readFileSync(join(LEGACY_REPO, "src/data/journey.ts"), "utf8");
  for (const match of journey.matchAll(/id:\s*"([^"]+)"/g)) paths.add(`/journey/${match[1]!}`);

  const pagesDir = join(LEGACY_REPO, "src/app/(pages)");
  for (const entry of readdirSync(pagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith("[")) continue;
    // Admin and preview are authenticated internal tools, not public URLs.
    if (entry.name === "admin" || entry.name === "preview") continue;
    paths.add(`/${entry.name}`);
  }

  return [...paths];
}

async function routesFromSitemap(): Promise<string[]> {
  const index = await fetch(`${SITE}/sitemap.xml`).then((r) => r.text());
  const sitemaps = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
  const targets = sitemaps.some((url) => url.includes("sitemap-"))
    ? sitemaps
    : [`${SITE}/sitemap.xml`];

  const locs: string[] = [];
  for (const url of targets) {
    const xml = await fetch(url).then((r) => r.text());
    locs.push(...[...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!));
  }
  return locs
    .filter((url) => !url.endsWith(".xml"))
    .map((url) => new URL(url).pathname.replace(/\/$/, "") || "/");
}

function textOf(html: string, pattern: RegExp): string | null {
  return pattern.exec(html)?.[1]?.trim() ?? null;
}

function decodeEntities(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'");
}

function stripTags(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

interface PageSnapshot {
  seo: SeoRecord;
  links: LinkRecord;
  media: MediaRecord;
}

function snapshotOf(path: string, status: number, html: string): PageSnapshot {
  const robots = textOf(html, /<meta[^>]+name="robots"[^>]+content="([^"]*)"/i);
  const jsonLdTypes = [
    ...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi),
  ].flatMap((m) => {
    try {
      const parsed = JSON.parse(m[1]!) as { "@type"?: string } | { "@type"?: string }[];
      return (Array.isArray(parsed) ? parsed : [parsed]).map((node) => node["@type"] ?? "unknown");
    } catch {
      return ["invalid"];
    }
  });

  return {
    seo: {
      path,
      status,
      title: textOf(html, /<title[^>]*>([\s\S]*?)<\/title>/i)?.replace(/\s+/g, " ") ?? null,
      description: textOf(html, /<meta[^>]+name="description"[^>]+content="([^"]*)"/i),
      canonical: textOf(html, /<link[^>]+rel="canonical"[^>]+href="([^"]*)"/i),
      robots,
      indexable: !(robots ?? "").toLowerCase().includes("noindex"),
      h1: [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => stripTags(m[1]!)),
      jsonLdTypes,
      ogTitle: textOf(html, /<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i),
      ogImage: textOf(html, /<meta[^>]+property="og:image"[^>]+content="([^"]*)"/i),
    },
    links: {
      path,
      internalLinks: [
        ...new Set(
          [...html.matchAll(/<a[^>]+href="(\/[^"#?]*)"/gi)]
            .map((m) => m[1]!.replace(/\/$/, "") || "/")
            .filter((href) => !href.startsWith("//")),
        ),
      ],
    },
    media: {
      path,
      images: [...html.matchAll(/<img[^>]*>/gi)].map((tag) => ({
        src: textOf(tag[0], /src="([^"]*)"/i) ?? "",
        alt: textOf(tag[0], /alt="([^"]*)"/i),
      })),
    },
  };
}

async function crawl(
  paths: readonly string[],
): Promise<Map<string, PageSnapshot & { status: number }>> {
  const results = new Map<string, PageSnapshot & { status: number }>();
  const queue = [...paths];

  const worker = async (): Promise<void> => {
    for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
      try {
        // The CDN rate-limits a fast crawl with 403s, which would otherwise be
        // recorded as a baseline of broken pages.
        let response = await fetch(`${SITE}${path}`, { redirect: "manual" });
        for (
          let attempt = 1;
          attempt < MAX_ATTEMPTS && (response.status === 403 || response.status === 429);
          attempt++
        ) {
          await sleep(DELAY_MS * 4 * attempt);
          response = await fetch(`${SITE}${path}`, { redirect: "manual" });
        }
        const html = response.status === 200 ? await response.text() : "";
        results.set(path, { ...snapshotOf(path, response.status, html), status: response.status });
        await sleep(DELAY_MS);
      } catch (error) {
        results.set(path, {
          ...snapshotOf(path, 0, ""),
          status: 0,
          seo: { ...snapshotOf(path, 0, "").seo, title: `fetch failed: ${String(error)}` },
        });
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return results;
}

const fromRepo = new Set(routesFromRepository());
const fromSitemap = new Set(await routesFromSitemap());
const allPaths = [...new Set([...fromRepo, ...fromSitemap])].toSorted();

const crawled = await crawl(allPaths);

const routes: RouteRecord[] = allPaths.map((path) => ({
  path,
  source:
    fromRepo.has(path) && fromSitemap.has(path)
      ? "both"
      : fromRepo.has(path)
        ? "repository"
        : "sitemap",
  status: crawled.get(path)?.status ?? null,
  inSitemap: fromSitemap.has(path),
}));

mkdirSync(OUT_DIR, { recursive: true });
const write = (name: string, data: unknown): void =>
  writeFileSync(join(OUT_DIR, name), `${JSON.stringify(data, null, 2)}\n`);

write("legacy-routes.json", routes);
write(
  "legacy-seo.json",
  allPaths.map((p) => crawled.get(p)!.seo),
);
write(
  "legacy-links.json",
  allPaths.map((p) => crawled.get(p)!.links),
);
write(
  "legacy-media.json",
  allPaths.map((p) => crawled.get(p)!.media),
);

const ok = routes.filter((r) => r.status === 200).length;
const missing = routes.filter((r) => r.status !== 200);
process.stdout.write(
  `✓ baseline ${routes.length} routes | 200 ${ok} | sitemap ${fromSitemap.size} | repo ${fromRepo.size}\n`,
);
if (missing.length > 0) {
  process.stdout.write(`  non-200: ${missing.map((r) => `${r.path} (${r.status})`).join(", ")}\n`);
}
