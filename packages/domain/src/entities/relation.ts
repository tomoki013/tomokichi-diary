import type { ArticleId, CategoryId, LocationId, PlaceId, TagId } from "../primitives/id.js";

/**
 * How strongly an article is about a place or a location. `primary` is what the
 * article is *for*; the rest support related-content and internal linking.
 */
export const RELATIONS = ["primary", "visited", "mentioned", "related"] as const;
export type Relation = (typeof RELATIONS)[number];

export interface ArticleLocation {
  readonly articleId: ArticleId;
  readonly locationId: LocationId;
  readonly relation: Relation;
}

export interface ArticlePlace {
  readonly articleId: ArticleId;
  readonly placeId: PlaceId;
  readonly relation: Relation;
}

export interface ArticleCategory {
  readonly articleId: ArticleId;
  readonly categoryId: CategoryId;
}

export interface ArticleTag {
  readonly articleId: ArticleId;
  readonly tagId: TagId;
}
