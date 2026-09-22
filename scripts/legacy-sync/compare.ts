import type { NormalizedArticle } from "./normalized-article.js";

export type ParityStatus = "MATCHED" | "NEW_ONLY" | "OLD_ONLY" | "CONFLICT";

/** Fields the report and the CI check look at, in the order they are shown. */
export const COMPARED_FIELDS = [
  "title",
  "description",
  "summary",
  "publishedAt",
  "updatedAt",
  "noindex",
  "canonical",
  "cover",
  "headings",
  "body",
  "images",
  "links",
] as const;
export type ComparedField = (typeof COMPARED_FIELDS)[number];

export interface FieldDifference {
  readonly field: ComparedField;
  readonly newValue: string;
  readonly oldValue: string;
}

export interface ParityEntry {
  readonly slug: string;
  readonly url: string;
  readonly status: ParityStatus;
  readonly newArticle: NormalizedArticle | null;
  readonly oldArticle: NormalizedArticle | null;
  readonly differences: readonly FieldDifference[];
}

function projection(article: NormalizedArticle, field: ComparedField): string {
  switch (field) {
    case "title":
    case "description":
    case "summary":
    case "publishedAt":
    case "updatedAt":
    case "body":
      return article[field];
    case "noindex":
      return String(article.noindex);
    case "canonical":
      return article.seo.canonical;
    case "cover":
      return article.cover ?? "";
    case "headings":
      return article.headings.map((h) => `${"#".repeat(h.level)} ${h.text}`).join("\n");
    case "images":
      return article.images.join("\n");
    case "links":
      return article.links.join("\n");
  }
}

export function diffArticles(
  newArticle: NormalizedArticle,
  oldArticle: NormalizedArticle,
): FieldDifference[] {
  return COMPARED_FIELDS.flatMap((field) => {
    const newValue = projection(newArticle, field);
    const oldValue = projection(oldArticle, field);
    return newValue === oldValue ? [] : [{ field, newValue, oldValue }];
  });
}

/**
 * Pairs articles across the two sites. The public URL is the join key: it is
 * the one identifier both sites agree on and the one Search Console knows.
 * (The 2.0 article id does not exist on the legacy side, and titles are
 * editorial and may legitimately change.)
 */
export function compareArticles(
  newArticles: readonly NormalizedArticle[],
  oldArticles: readonly NormalizedArticle[],
): ParityEntry[] {
  const oldByUrl = new Map(oldArticles.map((a) => [a.url, a]));
  const entries: ParityEntry[] = [];

  for (const newArticle of newArticles) {
    const oldArticle = oldByUrl.get(newArticle.url) ?? null;
    oldByUrl.delete(newArticle.url);
    if (!oldArticle) {
      entries.push({
        slug: newArticle.slug,
        url: newArticle.url,
        status: "NEW_ONLY",
        newArticle,
        oldArticle: null,
        differences: [],
      });
      continue;
    }
    const differences = diffArticles(newArticle, oldArticle);
    entries.push({
      slug: newArticle.slug,
      url: newArticle.url,
      status: differences.length === 0 ? "MATCHED" : "CONFLICT",
      newArticle,
      oldArticle,
      differences,
    });
  }

  for (const oldArticle of oldByUrl.values()) {
    entries.push({
      slug: oldArticle.slug,
      url: oldArticle.url,
      status: "OLD_ONLY",
      newArticle: null,
      oldArticle,
      differences: [],
    });
  }

  return entries.toSorted((a, b) => a.url.localeCompare(b.url));
}

export function summarize(entries: readonly ParityEntry[]): Record<ParityStatus, number> {
  const counts: Record<ParityStatus, number> = {
    MATCHED: 0,
    NEW_ONLY: 0,
    OLD_ONLY: 0,
    CONFLICT: 0,
  };
  for (const entry of entries) counts[entry.status]++;
  return counts;
}
