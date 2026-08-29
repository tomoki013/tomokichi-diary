import type { Article } from "../entities/article.js";
import type { ArticleId } from "../primitives/id.js";
import type { Instant } from "../primitives/datetime.js";
import type { RelationIndex } from "./listing.js";
import { isPubliclyVisible } from "./publishing.js";

/**
 * Related articles are computed from entity relations rather than from text
 * similarity, so internal links stay meaningful for readers and for machines
 * reading the same structure (instruction §39, §81).
 */
const WEIGHTS = { place: 5, primaryLocation: 4, location: 2, category: 3, tag: 1 } as const;

export interface RelatedArticle {
  readonly articleId: ArticleId;
  readonly score: number;
  readonly reasons: readonly string[];
}

function setsOf(articleId: ArticleId, relations: RelationIndex) {
  return {
    places: new Set(
      relations.places.filter((r) => r.articleId === articleId).map((r) => r.placeId),
    ),
    primaryLocations: new Set(
      relations.locations
        .filter((r) => r.articleId === articleId && r.relation === "primary")
        .map((r) => r.locationId),
    ),
    locations: new Set(
      relations.locations.filter((r) => r.articleId === articleId).map((r) => r.locationId),
    ),
    categories: new Set(
      relations.categories.filter((r) => r.articleId === articleId).map((r) => r.categoryId),
    ),
    tags: new Set(relations.tags.filter((r) => r.articleId === articleId).map((r) => r.tagId)),
  };
}

function overlap<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): number {
  let count = 0;
  for (const value of a) if (b.has(value)) count++;
  return count;
}

export function findRelatedArticles(params: {
  articleId: ArticleId;
  articles: readonly Article[];
  relations: RelationIndex;
  now: Instant;
  limit?: number;
}): readonly RelatedArticle[] {
  const source = setsOf(params.articleId, params.relations);
  const limit = params.limit ?? 6;

  const scored: RelatedArticle[] = [];
  for (const candidate of params.articles) {
    if (candidate.id === params.articleId) continue;
    if (!isPubliclyVisible(candidate, params.now)) continue;

    const other = setsOf(candidate.id, params.relations);
    const parts: Array<[string, number]> = [
      ["place", overlap(source.places, other.places) * WEIGHTS.place],
      [
        "primaryLocation",
        overlap(source.primaryLocations, other.primaryLocations) * WEIGHTS.primaryLocation,
      ],
      ["location", overlap(source.locations, other.locations) * WEIGHTS.location],
      ["category", overlap(source.categories, other.categories) * WEIGHTS.category],
      ["tag", overlap(source.tags, other.tags) * WEIGHTS.tag],
    ];
    const score = parts.reduce((sum, [, value]) => sum + value, 0);
    if (score === 0) continue;

    scored.push({
      articleId: candidate.id,
      score,
      reasons: parts.filter(([, value]) => value > 0).map(([name]) => name),
    });
  }

  // Ties break on recency so a stale article never pins itself to the top.
  const publishedAt = new Map(params.articles.map((a) => [a.id, a.publishedAt ?? a.createdAt]));
  return scored
    .toSorted(
      (a, b) =>
        b.score - a.score ||
        (publishedAt.get(b.articleId) ?? "").localeCompare(publishedAt.get(a.articleId) ?? ""),
    )
    .slice(0, limit);
}
