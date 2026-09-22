import {
  RouteTable,
  extractHeadings,
  extractImages,
  extractInternalLinks,
  normalizeRoutePath,
  stripCodeFences,
  type Heading,
} from "@tomokichi/domain";
import type { ContentSnapshot } from "@tomokichi/data";
import type { LegacyPost } from "../lib/legacy-source.js";

/**
 * The shape both sites are reduced to before they are compared.
 *
 * Neither Astro's export nor the Next.js frontmatter is compared directly:
 * each is projected onto this record first, so a difference here is a
 * difference a reader or a crawler would see, never a difference in how the
 * two frameworks happen to store the same thing.
 */
export interface NormalizedArticle {
  /** Stable identity: the Diary 2.0 article id, or `legacy:<slug>` for the old site. */
  readonly id: string;
  readonly slug: string;
  /** Public path, identical on both sites (`/posts/<slug>`). */
  readonly url: string;
  readonly title: string;
  /** What the meta description is built from (override or summary). */
  readonly description: string;
  readonly summary: string;
  /** `YYYY-MM-DD`; both sites publish at day granularity. */
  readonly publishedAt: string;
  readonly updatedAt: string;
  readonly noindex: boolean;
  readonly headings: readonly Heading[];
  /** Body Markdown with framework-only syntax removed and links canonicalised. */
  readonly body: string;
  readonly cover: string | null;
  readonly images: readonly string[];
  /** Internal links after following the 2.0 redirect table. */
  readonly links: readonly string[];
  readonly seo: { readonly canonical: string; readonly robots: string };
}

export const ARTICLE_PATH_PREFIX = "/posts/";

const EMBED_LINE_RE = /^[ \t]*\{\{embed:[a-z0-9-]+\}\}[ \t]*$/gm;
const INTERNAL_LINK_RE = /(\]\()(\/[^)\s]*)(\)|\s)/g;

function day(instant: string | null | undefined): string {
  return (instant ?? "").slice(0, 10);
}

/**
 * Resolves an internal link the way the 2.0 site will serve it: a legacy path
 * that 301s to a new one counts as the new one. Links the route table does not
 * know are left untouched so they still show up as a difference.
 */
export function canonicaliseLink(table: RouteTable, href: string): string {
  const [pathOnly, hash] = href.split("#");
  const resolved = table.resolve(pathOnly ?? "/");
  const path = resolved.ok && resolved.value.destination ? resolved.value.destination : pathOnly;
  return hash ? `${path}#${hash}` : (path ?? href);
}

/**
 * The comparable body. Embeds are 2.0-only syntax whose data the legacy site
 * carries in frontmatter; blank-line runs and trailing whitespace are
 * formatting, not content.
 */
export function normalizeBody(table: RouteTable, markdown: string): string {
  return markdown
    .replace(EMBED_LINE_RE, "")
    .replace(
      INTERNAL_LINK_RE,
      (_match, open: string, href: string, close: string) =>
        `${open}${canonicaliseLink(table, href)}${close}`,
    )
    .split("\n")
    .map((line) => (line.trimStart().startsWith("|") ? normalizeTableRow(line) : line.trimEnd()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Prettier pads table cells to align columns; the padding carries no meaning. */
function normalizeTableRow(line: string): string {
  return line
    .trim()
    .split("|")
    .map((cell) => cell.trim().replace(/^(:?)-{3,}(:?)$/, "$1---$2"))
    .join("|");
}

function linksOf(table: RouteTable, body: string): string[] {
  return [...new Set(extractInternalLinks(stripCodeFences(body)))]
    .map((href) => canonicaliseLink(table, href))
    .toSorted();
}

function imagesOf(body: string): string[] {
  return extractImages(body).map((image) => image.src);
}

/**
 * Only the indexing intent is compared. The 2.0 site emits `noindex, nofollow`
 * where the legacy site emits `noindex, follow`; that is a template decision,
 * not a per-article one, and is recorded in docs/migration/legacy-content-sync.md.
 */
function robotsOf(noindex: boolean): string {
  return noindex ? "noindex" : "index";
}

/** Every published article the 2.0 site serves under `/posts/`. */
export function normalizeSnapshot(snapshot: ContentSnapshot): NormalizedArticle[] {
  const table = new RouteTable(snapshot.routes);
  const revisionById = new Map(snapshot.revisions.map((r) => [r.id, r]));
  const mediaById = new Map(snapshot.media.map((m) => [m.id, m]));

  return snapshot.articles
    .filter((article) => article.kind === "article" && article.status === "published")
    .flatMap((article) => {
      const revision = article.publishedRevisionId
        ? revisionById.get(article.publishedRevisionId)
        : undefined;
      const route = table.canonicalFor("article", article.id);
      if (!revision || !route || !route.path.startsWith(ARTICLE_PATH_PREFIX)) return [];

      const coverRelation = snapshot.articleMedia.find(
        (m) => m.articleId === article.id && m.role === "cover",
      );
      const cover = coverRelation ? mediaById.get(coverRelation.mediaId) : undefined;
      const body = normalizeBody(table, revision.bodyMarkdown);

      return [
        {
          id: article.id,
          slug: article.slug,
          url: route.path,
          title: revision.title.trim(),
          description: (revision.seoDescriptionOverride?.trim() || revision.summary).trim(),
          summary: revision.summary.trim(),
          publishedAt: day(article.publishedAt),
          updatedAt: day(article.updatedAt),
          noindex: article.noindex || route.noindex,
          headings: extractHeadings(body),
          body,
          cover: cover ? `/${cover.storageKey}` : null,
          images: imagesOf(body),
          links: linksOf(table, revision.bodyMarkdown),
          seo: { canonical: route.path, robots: robotsOf(article.noindex || route.noindex) },
        },
      ];
    })
    .toSorted((a, b) => a.slug.localeCompare(b.slug));
}

/** Every post in the legacy `posts/` directory (drafts are not published). */
export function normalizeLegacyPosts(
  posts: readonly LegacyPost[],
  routes: ContentSnapshot["routes"],
): NormalizedArticle[] {
  const table = new RouteTable(routes);
  return posts
    .map((post) => {
      const fm = post.frontmatter;
      const body = normalizeBody(table, post.body);
      const noindex = fm.noindex === true;
      const url = normalizeRoutePath(`${ARTICLE_PATH_PREFIX}${post.slug}`);
      return {
        id: `legacy:${post.slug}`,
        slug: post.slug,
        url,
        title: fm.title.trim(),
        description: (fm.description || fm.excerpt).trim(),
        summary: fm.excerpt.trim(),
        publishedAt: day(String(fm.publishedAt)),
        updatedAt: day(String(fm.updatedAt ?? fm.publishedAt)),
        noindex,
        headings: extractHeadings(body),
        body,
        cover: fm.heroImage || null,
        images: imagesOf(body),
        links: linksOf(table, post.body),
        seo: { canonical: url, robots: robotsOf(noindex) },
      };
    })
    .toSorted((a, b) => a.slug.localeCompare(b.slug));
}
