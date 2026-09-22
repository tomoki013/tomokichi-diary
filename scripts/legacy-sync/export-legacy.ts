import { RouteTable, extractImages, type Route } from "@tomokichi/domain";
import type { ContentSnapshot } from "@tomokichi/data";
import { ARTICLE_PATH_PREFIX, normalizeBody } from "./normalized-article.js";

/**
 * NEW → OLD projection: turns a published Diary 2.0 article into the Markdown
 * file the legacy Next.js site reads from `posts/<slug>.md`.
 *
 * The legacy frontmatter carries editorial data the 2.0 model does not
 * (`journeyId`, `travelTopics`, `costReport`, …). Those keys are preserved from
 * the existing legacy file untouched; only the keys that describe content 2.0
 * owns are rewritten. Nothing flows back.
 */
export interface LegacyExportResult {
  readonly slug: string;
  readonly contents: string;
  /** `/images/...` paths referenced by the article; the caller copies missing files. */
  readonly imagePaths: readonly string[];
  readonly changed: boolean;
}

/** Frontmatter keys whose value is decided by Diary 2.0. Everything else is preserved. */
const OWNED_KEYS = [
  "title",
  "excerpt",
  "description",
  "updatedAt",
  "noindex",
  "heroImage",
] as const;

/**
 * Where a 2.0 path is not served by the legacy site and several legacy paths
 * redirect to it, the one to emit. Everything else is derived from the route
 * table (the legacy alias is the redirect whose target is the 2.0 path).
 */
const PREFERRED_LEGACY_ALIAS: Record<string, string> = { "/collections": "/series" };

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const EMBED_LINE_RE = /^[ \t]*\{\{embed:[a-z0-9-]+\}\}[ \t]*\n?/gm;
const INTERNAL_LINK_RE = /(\]\()(\/[^)\s]*)(\)|\s)/g;

const PLAIN_SCALAR_RE = /^[^\s\-?:,[\]{}#&*!|>'"%@`][^#]*$/;

/** YAML scalar as the legacy files write it: plain when safe, double-quoted otherwise. */
export function yamlScalar(value: string): string {
  if (PLAIN_SCALAR_RE.test(value) && !value.includes(": ") && value.trim() === value) {
    return value;
  }
  return JSON.stringify(value);
}

function day(instant: string | null): string {
  return (instant ?? "").slice(0, 10);
}

/**
 * Maps a 2.0 internal link onto the path the legacy site serves. Article
 * paths are identical on both sites; tidied static paths (`/legal/privacy`,
 * `/collections/...`) go back through the redirect that keeps their old URL alive.
 */
export function legacyPathFor(routes: readonly Route[], path: string): string {
  if (path.startsWith(ARTICLE_PATH_PREFIX)) return path;
  const route = routes.find((r) => r.path === path);
  if (route?.isLegacy && route.targetType !== "redirect") return path;
  const preferred = PREFERRED_LEGACY_ALIAS[path];
  if (preferred && routes.some((r) => r.path === preferred)) return preferred;
  const aliases = routes
    .filter((r) => r.targetType === "redirect" && r.redirectTo === path && r.isLegacy)
    .map((r) => r.path)
    .toSorted();
  return aliases[0] ?? path;
}

export function toLegacyBody(routes: readonly Route[], bodyMarkdown: string): string {
  return bodyMarkdown
    .replace(EMBED_LINE_RE, "")
    .replace(INTERNAL_LINK_RE, (_m, open: string, href: string, close: string) => {
      const [pathOnly, hash] = href.split("#");
      const mapped = legacyPathFor(routes, pathOnly ?? href);
      return `${open}${hash ? `${mapped}#${hash}` : mapped}${close}`;
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const keyOf = (line: string): string | null => /^([A-Za-z_][\w-]*):/.exec(line)?.[1] ?? null;

interface OwnedValues {
  title: string;
  excerpt: string;
  description: string | null;
  updatedAt: string | null;
  noindex: boolean;
  heroImage: string | null;
}

/**
 * Rewrites only the owned keys inside an existing frontmatter block, keeping
 * every other line — order, quoting and nested structures — exactly as the
 * author left it, so the legacy diff shows nothing but the content change.
 */
export function mergeFrontmatter(existing: string, owned: OwnedValues): string {
  const lines = existing.split("\n");
  const rendered: Partial<Record<(typeof OWNED_KEYS)[number], string | null>> = {
    title: yamlScalar(owned.title),
    excerpt: yamlScalar(owned.excerpt),
    description: owned.description === null ? null : yamlScalar(owned.description),
    updatedAt: owned.updatedAt === null ? null : JSON.stringify(owned.updatedAt),
    noindex: owned.noindex ? "true" : null,
    heroImage: owned.heroImage,
  };
  const anchors: Record<(typeof OWNED_KEYS)[number], string | null> = {
    title: null,
    excerpt: "title",
    description: "excerpt",
    updatedAt: "publishedAt",
    noindex: null,
    heroImage: null,
  };

  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const key = keyOf(line);
    if (key && (OWNED_KEYS as readonly string[]).includes(key)) {
      seen.add(key);
      const value = rendered[key as (typeof OWNED_KEYS)[number]];
      if (value !== null && value !== undefined) out.push(`${key}: ${value}`);
      continue;
    }
    out.push(line);
  }

  for (const key of OWNED_KEYS) {
    const value = rendered[key];
    if (seen.has(key) || value === null || value === undefined) continue;
    const anchor = anchors[key];
    const index = anchor ? out.findIndex((line) => keyOf(line) === anchor) : -1;
    if (index === -1) out.push(`${key}: ${value}`);
    else {
      // Skip past a block value that follows the anchor (nested keys are indented).
      let end = index + 1;
      while (end < out.length && /^\s+\S/.test(out[end]!)) end++;
      out.splice(end, 0, `${key}: ${value}`);
    }
  }
  return out.join("\n");
}

interface ArticleView {
  id: string;
  slug: string;
  path: string;
  title: string;
  summary: string;
  description: string | null;
  bodyMarkdown: string;
  publishedAt: string | null;
  updatedAt: string;
  noindex: boolean;
  travelStartDate: string | null;
  travelEndDate: string | null;
  cover: string | null;
  tags: string[];
  category: string | null;
  regionIds: string[];
  series: string | null;
}

function viewsOf(snapshot: ContentSnapshot): ArticleView[] {
  const table = new RouteTable(snapshot.routes);
  const revisionById = new Map(snapshot.revisions.map((r) => [r.id, r]));
  const mediaById = new Map(snapshot.media.map((m) => [m.id, m]));
  const tagById = new Map(snapshot.tags.map((t) => [t.id, t]));
  const categoryById = new Map(snapshot.categories.map((c) => [c.id, c]));
  const locationById = new Map(snapshot.locations.map((l) => [l.id, l]));
  const collectionById = new Map(snapshot.collections.map((c) => [c.id, c]));

  return snapshot.articles.flatMap((article) => {
    if (article.kind !== "article" || article.status !== "published") return [];
    const revision = article.publishedRevisionId
      ? revisionById.get(article.publishedRevisionId)
      : undefined;
    const route = table.canonicalFor("article", article.id);
    if (!revision || !route || !route.path.startsWith(ARTICLE_PATH_PREFIX)) return [];

    const coverRelation = snapshot.articleMedia.find(
      (m) => m.articleId === article.id && m.role === "cover",
    );
    const cover = coverRelation ? mediaById.get(coverRelation.mediaId) : undefined;
    const locations = snapshot.articleLocations
      .filter((l) => l.articleId === article.id)
      .toSorted((a, b) => (a.relation === "primary" ? -1 : b.relation === "primary" ? 1 : 0));
    const series = snapshot.articleCollections
      .map((c) => (c.articleId === article.id ? collectionById.get(c.collectionId) : undefined))
      .find((c) => c?.kind === "series");
    const category = snapshot.articleCategories.find((c) => c.articleId === article.id);

    return [
      {
        id: article.id,
        slug: article.slug,
        path: route.path,
        title: revision.title,
        summary: revision.summary,
        description: revision.seoDescriptionOverride?.trim() || null,
        bodyMarkdown: revision.bodyMarkdown,
        publishedAt: article.publishedAt,
        updatedAt: article.updatedAt,
        noindex: article.noindex || route.noindex,
        travelStartDate: article.travelStartDate,
        travelEndDate: article.travelEndDate,
        cover: cover ? `/${cover.storageKey}` : null,
        tags: snapshot.articleTags
          .filter((t) => t.articleId === article.id)
          .map((t) => tagById.get(t.tagId)?.name ?? "")
          .filter(Boolean),
        category: category ? (categoryById.get(category.categoryId)?.slug ?? null) : null,
        regionIds: locations.map((l) => locationById.get(l.locationId)?.slug ?? "").filter(Boolean),
        series: series?.slug ?? null,
      },
    ];
  });
}

function ownedValues(view: ArticleView): OwnedValues {
  const published = day(view.publishedAt);
  const updated = day(view.updatedAt);
  return {
    title: view.title,
    excerpt: view.summary,
    description: view.description,
    updatedAt: updated && updated !== published ? updated : null,
    noindex: view.noindex,
    heroImage: view.cover,
  };
}

/** Frontmatter for an article that has never existed on the legacy site. */
function freshFrontmatter(view: ArticleView): string {
  const owned = ownedValues(view);
  const lines = [`title: ${yamlScalar(owned.title)}`, `excerpt: ${yamlScalar(owned.excerpt)}`];
  if (owned.description) lines.push(`description: ${yamlScalar(owned.description)}`);
  lines.push(`publishedAt: ${JSON.stringify(day(view.publishedAt))}`);
  if (owned.updatedAt) lines.push(`updatedAt: ${JSON.stringify(owned.updatedAt)}`);
  if (view.travelStartDate) {
    lines.push("travelDates:", `  start: ${JSON.stringify(view.travelStartDate)}`);
    if (view.travelEndDate) lines.push(`  end: ${JSON.stringify(view.travelEndDate)}`);
  }
  lines.push(`category: ${view.category ?? "tourism"}`);
  if (view.tags.length > 0) lines.push("tags:", ...view.tags.map((t) => `  - ${yamlScalar(t)}`));
  if (owned.heroImage) lines.push(`heroImage: ${owned.heroImage}`);
  if (view.regionIds.length > 0) lines.push("regionIds:", ...view.regionIds.map((r) => `  - ${r}`));
  lines.push("author: ともきち");
  if (view.series) lines.push("series:", `  slug: ${view.series}`);
  if (owned.noindex) lines.push("noindex: true");
  return lines.join("\n");
}

/**
 * Builds every legacy post file. `readExisting` returns the current legacy
 * file for a slug, or null; its frontmatter and — when the content is already
 * equal — its body are kept verbatim so a no-op sync produces no diff.
 */
export function buildLegacyPosts(
  snapshot: ContentSnapshot,
  readExisting: (slug: string) => string | null,
): LegacyExportResult[] {
  const table = new RouteTable(snapshot.routes);
  return viewsOf(snapshot)
    .map((view) => {
      const existing = readExisting(view.slug);
      const match = existing ? FRONTMATTER_RE.exec(existing) : null;
      const existingFrontmatter = match?.[1] ?? null;
      const existingBody = match ? existing!.slice(match[0].length).trim() : null;

      const frontmatter =
        existingFrontmatter !== null
          ? mergeFrontmatter(existingFrontmatter, ownedValues(view))
          : freshFrontmatter(view);

      const newBody = toLegacyBody(snapshot.routes, view.bodyMarkdown);
      const body =
        existingBody !== null &&
        normalizeBody(table, existingBody) === normalizeBody(table, view.bodyMarkdown)
          ? existingBody
          : newBody;

      const contents = `---\n${frontmatter}\n---\n\n${body}\n`;
      const imagePaths = [
        ...new Set([
          ...(view.cover ? [view.cover] : []),
          ...extractImages(view.bodyMarkdown)
            .map((i) => i.src)
            .filter((src) => src.startsWith("/images/")),
        ]),
      ];
      return { slug: view.slug, contents, imagePaths, changed: contents !== existing };
    })
    .toSorted((a, b) => a.slug.localeCompare(b.slug));
}
