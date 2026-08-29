import type { Article } from "../entities/article.js";
import type {
  ArticleCategory,
  ArticleLocation,
  ArticlePlace,
  ArticleTag,
} from "../entities/relation.js";
import type { ArticleId, CategoryId, LocationId, PlaceId, TagId } from "../primitives/id.js";
import type { Instant } from "../primitives/datetime.js";
import { isPubliclyVisible } from "./publishing.js";

export type ArticleSort = "published_desc" | "published_asc" | "updated_desc" | "title_asc";

export interface ArticleFilter {
  readonly categoryId?: CategoryId;
  readonly tagId?: TagId;
  readonly locationId?: LocationId;
  readonly placeId?: PlaceId;
  /** Includes descendants of the given location, e.g. a country page listing city articles. */
  readonly locationDescendants?: readonly LocationId[];
}

export interface RelationIndex {
  readonly categories: readonly ArticleCategory[];
  readonly tags: readonly ArticleTag[];
  readonly locations: readonly ArticleLocation[];
  readonly places: readonly ArticlePlace[];
}

export const EMPTY_RELATIONS: RelationIndex = {
  categories: [],
  tags: [],
  locations: [],
  places: [],
};

function matches(article: Article, filter: ArticleFilter, relations: RelationIndex): boolean {
  const { id } = article;
  if (
    filter.categoryId &&
    !relations.categories.some((r) => r.articleId === id && r.categoryId === filter.categoryId)
  ) {
    return false;
  }
  if (filter.tagId && !relations.tags.some((r) => r.articleId === id && r.tagId === filter.tagId))
    return false;
  if (
    filter.placeId &&
    !relations.places.some((r) => r.articleId === id && r.placeId === filter.placeId)
  )
    return false;

  if (filter.locationId) {
    const wanted = new Set<LocationId>([filter.locationId, ...(filter.locationDescendants ?? [])]);
    if (!relations.locations.some((r) => r.articleId === id && wanted.has(r.locationId)))
      return false;
  }
  return true;
}

export function compareArticles(sort: ArticleSort, titleOf: (id: ArticleId) => string) {
  return (a: Article, b: Article): number => {
    switch (sort) {
      case "published_desc":
        return (b.publishedAt ?? b.createdAt).localeCompare(a.publishedAt ?? a.createdAt);
      case "published_asc":
        return (a.publishedAt ?? a.createdAt).localeCompare(b.publishedAt ?? b.createdAt);
      case "updated_desc":
        return b.updatedAt.localeCompare(a.updatedAt);
      case "title_asc":
        return titleOf(a.id).localeCompare(titleOf(b.id), "ja");
    }
  };
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly hasMore: boolean;
}

export function paginate<T>(items: readonly T[], offset: number, limit: number): Page<T> {
  const start = Math.max(0, offset);
  const size = Math.max(1, Math.min(limit, 100));
  return {
    items: items.slice(start, start + size),
    total: items.length,
    offset: start,
    limit: size,
    hasMore: start + size < items.length,
  };
}

export function listPublicArticles(params: {
  articles: readonly Article[];
  relations?: RelationIndex;
  filter?: ArticleFilter;
  sort?: ArticleSort;
  now: Instant;
  titleOf?: (id: ArticleId) => string;
}): readonly Article[] {
  const relations = params.relations ?? EMPTY_RELATIONS;
  const filter = params.filter ?? {};
  return params.articles
    .filter(
      (article) => isPubliclyVisible(article, params.now) && matches(article, filter, relations),
    )
    .toSorted(compareArticles(params.sort ?? "published_desc", params.titleOf ?? (() => "")));
}
