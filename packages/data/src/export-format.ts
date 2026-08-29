import type { ContentSnapshot } from "./snapshot.js";

/**
 * Vendor-neutral export (instruction §53).
 *
 * Article bodies are written as Markdown files so the archive is readable and
 * diffable on its own; the JSON files carry the structured graph and are what
 * an import reads back. Nothing here mentions D1, R2 or Cloudflare, so the
 * archive restores into any store that can satisfy the repository ports.
 */
export interface ExportFile {
  readonly path: string;
  readonly contents: string;
}

export const EXPORT_MANIFEST_VERSION = 1;

function escapeYamlScalar(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function frontmatter(fields: Record<string, string | number | boolean | null>): string {
  const lines = Object.entries(fields)
    .filter(([, value]) => value !== null)
    .map(
      ([key, value]) =>
        `${key}: ${typeof value === "string" ? escapeYamlScalar(value) : String(value)}`,
    );
  return ["---", ...lines, "---", ""].join("\n");
}

/** One file per published article: `export/articles/<slug>.md`. */
export function articleMarkdownFiles(snapshot: ContentSnapshot): ExportFile[] {
  const revisionById = new Map(snapshot.revisions.map((r) => [r.id, r]));
  const canonicalPath = new Map(
    snapshot.routes
      .filter((r) => r.isCanonical && r.targetType === "article" && r.targetId !== null)
      .map((r) => [r.targetId!, r.path]),
  );

  return snapshot.articles.flatMap((article) => {
    const revision = article.publishedRevisionId
      ? revisionById.get(article.publishedRevisionId)
      : undefined;
    if (!revision) return [];
    return [
      {
        path: `articles/${article.slug}.md`,
        contents:
          frontmatter({
            id: article.id,
            slug: article.slug,
            locale: article.locale,
            status: article.status,
            path: canonicalPath.get(article.id) ?? null,
            title: revision.title,
            summary: revision.summary,
            revision: revision.revisionNumber,
            publishedAt: article.publishedAt,
            updatedAt: article.updatedAt,
            noindex: article.noindex,
          }) +
          revision.bodyMarkdown.trimEnd() +
          "\n",
      },
    ];
  });
}

const JSON_PARTS = [
  "articles",
  "revisions",
  "embeds",
  "routes",
  "locations",
  "locationNames",
  "places",
  "categories",
  "tags",
  "authors",
  "media",
  "articleMedia",
  "articleLocations",
  "articlePlaces",
  "articleCategories",
  "articleTags",
] as const;

const FILE_NAMES: Record<(typeof JSON_PARTS)[number], string> = {
  articles: "articles.json",
  revisions: "revisions.json",
  embeds: "embeds.json",
  routes: "routes.json",
  locations: "locations.json",
  locationNames: "location-names.json",
  places: "places.json",
  categories: "categories.json",
  tags: "tags.json",
  authors: "authors.json",
  media: "media.json",
  articleMedia: "relations/article-media.json",
  articleLocations: "relations/article-locations.json",
  articlePlaces: "relations/article-places.json",
  articleCategories: "relations/article-categories.json",
  articleTags: "relations/article-tags.json",
};

export function buildExportFiles(snapshot: ContentSnapshot): ExportFile[] {
  const files: ExportFile[] = [
    {
      path: "manifest.json",
      contents: `${JSON.stringify(
        {
          version: EXPORT_MANIFEST_VERSION,
          generatedAt: snapshot.generatedAt,
          counts: Object.fromEntries(JSON_PARTS.map((part) => [part, snapshot[part].length])),
        },
        null,
        2,
      )}\n`,
    },
  ];
  for (const part of JSON_PARTS) {
    files.push({
      path: FILE_NAMES[part],
      contents: `${JSON.stringify(snapshot[part], null, 2)}\n`,
    });
  }
  files.push(...articleMarkdownFiles(snapshot));
  return files;
}

/** Rebuilds a snapshot from the JSON parts of an export. Missing parts read as empty. */
export function parseExportFiles(read: (path: string) => string | null): ContentSnapshot {
  const part = <T>(path: string): readonly T[] => {
    const contents = read(path);
    if (contents === null) return [];
    const parsed: unknown = JSON.parse(contents);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  };
  const manifest = read("manifest.json");
  const generatedAt = manifest
    ? ((JSON.parse(manifest) as { generatedAt?: string }).generatedAt ?? new Date(0).toISOString())
    : new Date(0).toISOString();

  return {
    generatedAt,
    aiArtifacts: [],
    ...(Object.fromEntries(
      JSON_PARTS.map((name) => [name, part(FILE_NAMES[name])]),
    ) as unknown as Omit<ContentSnapshot, "generatedAt" | "aiArtifacts">),
  };
}
