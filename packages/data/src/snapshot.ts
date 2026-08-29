import type {
  AIArtifact,
  Article,
  ArticleCategory,
  ArticleEmbed,
  ArticleLocation,
  ArticleMedia,
  ArticlePlace,
  ArticleRevision,
  ArticleTag,
  Author,
  Category,
  Location,
  LocationName,
  MediaAsset,
  Place,
  Route,
  Tag,
} from "@tomokichi/domain";

/**
 * The whole public content graph in one plain object.
 *
 * The public site is built from this rather than from a live database, which is
 * what makes static generation possible and keeps Astro unaware of D1
 * (docs/adr/0006-build-time-content-snapshot.md). It is also exactly what
 * `pnpm export:data` writes to disk.
 */
export interface ContentSnapshot {
  readonly generatedAt: string;
  readonly articles: readonly Article[];
  readonly revisions: readonly ArticleRevision[];
  readonly embeds: readonly ArticleEmbed[];
  readonly routes: readonly Route[];
  readonly locations: readonly Location[];
  readonly locationNames: readonly LocationName[];
  readonly places: readonly Place[];
  readonly categories: readonly Category[];
  readonly tags: readonly Tag[];
  readonly authors: readonly Author[];
  readonly media: readonly MediaAsset[];
  readonly articleMedia: readonly ArticleMedia[];
  readonly articleLocations: readonly ArticleLocation[];
  readonly articlePlaces: readonly ArticlePlace[];
  readonly articleCategories: readonly ArticleCategory[];
  readonly articleTags: readonly ArticleTag[];
  readonly aiArtifacts: readonly AIArtifact[];
}

export const EMPTY_SNAPSHOT: ContentSnapshot = {
  generatedAt: "1970-01-01T00:00:00.000Z",
  articles: [],
  revisions: [],
  embeds: [],
  routes: [],
  locations: [],
  locationNames: [],
  places: [],
  categories: [],
  tags: [],
  authors: [],
  media: [],
  articleMedia: [],
  articleLocations: [],
  articlePlaces: [],
  articleCategories: [],
  articleTags: [],
  aiArtifacts: [],
};
