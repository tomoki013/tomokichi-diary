import type {
  AIArtifact,
  Article,
  ArticleCategory,
  ArticleEmbed,
  ArticleId,
  ArticleLocation,
  ArticleMedia,
  ArticlePlace,
  ArticleRevision,
  ArticleTag,
  Author,
  AuthorId,
  Category,
  CategoryId,
  Locale,
  Location,
  LocationId,
  LocationName,
  MediaAsset,
  MediaId,
  Place,
  PlaceId,
  RevisionId,
  Route,
  RoutePath,
  Slug,
  Tag,
  TagId,
} from "@tomokichi/domain";

/**
 * Ports, not abstractions for their own sake: each one exists because a use
 * case needs to reach outside the Core. Query shapes stay coarse so an adapter
 * can satisfy them with one statement.
 */

export interface ArticleRepository {
  findById(id: ArticleId): Promise<Article | null>;
  findBySlug(slug: Slug, locale: Locale): Promise<Article | null>;
  listAll(): Promise<readonly Article[]>;
  save(article: Article): Promise<void>;
  delete(id: ArticleId): Promise<void>;
}

export interface RevisionRepository {
  findById(id: RevisionId): Promise<ArticleRevision | null>;
  findLatest(articleId: ArticleId): Promise<ArticleRevision | null>;
  listByArticle(articleId: ArticleId): Promise<readonly ArticleRevision[]>;
  save(revision: ArticleRevision): Promise<void>;
}

export interface EmbedRepository {
  listByRevision(revisionId: RevisionId): Promise<readonly ArticleEmbed[]>;
  replaceForRevision(revisionId: RevisionId, embeds: readonly ArticleEmbed[]): Promise<void>;
}

export interface RouteRepository {
  findByPath(path: RoutePath): Promise<Route | null>;
  listAll(): Promise<readonly Route[]>;
  save(route: Route): Promise<void>;
  delete(path: RoutePath): Promise<void>;
}

export interface LocationRepository {
  listAll(): Promise<readonly Location[]>;
  listNames(): Promise<readonly LocationName[]>;
  findById(id: LocationId): Promise<Location | null>;
  save(location: Location, names: readonly LocationName[]): Promise<void>;
}

export interface PlaceRepository {
  listAll(): Promise<readonly Place[]>;
  findById(id: PlaceId): Promise<Place | null>;
  save(place: Place): Promise<void>;
}

export interface MediaRepository {
  findById(id: MediaId): Promise<MediaAsset | null>;
  findBySha256(sha256: string): Promise<MediaAsset | null>;
  listAll(): Promise<readonly MediaAsset[]>;
  save(asset: MediaAsset): Promise<void>;
  listForArticle(articleId: ArticleId): Promise<readonly ArticleMedia[]>;
  replaceForArticle(articleId: ArticleId, media: readonly ArticleMedia[]): Promise<void>;
}

export interface TaxonomyRepository {
  listCategories(): Promise<readonly Category[]>;
  listTags(): Promise<readonly Tag[]>;
  findCategoryById(id: CategoryId): Promise<Category | null>;
  findTagById(id: TagId): Promise<Tag | null>;
  saveCategory(category: Category): Promise<void>;
  saveTag(tag: Tag): Promise<void>;
}

export interface RelationRepository {
  listArticleLocations(): Promise<readonly ArticleLocation[]>;
  listArticlePlaces(): Promise<readonly ArticlePlace[]>;
  listArticleCategories(): Promise<readonly ArticleCategory[]>;
  listArticleTags(): Promise<readonly ArticleTag[]>;
  replaceForArticle(
    articleId: ArticleId,
    relations: {
      locations: readonly ArticleLocation[];
      places: readonly ArticlePlace[];
      categories: readonly ArticleCategory[];
      tags: readonly ArticleTag[];
    },
  ): Promise<void>;
}

export interface AuthorRepository {
  findById(id: AuthorId): Promise<Author | null>;
  listAll(): Promise<readonly Author[]>;
  save(author: Author): Promise<void>;
}

export interface AIArtifactRepository {
  listForEntity(
    entityType: AIArtifact["entityType"],
    entityId: string,
  ): Promise<readonly AIArtifact[]>;
  save(artifact: AIArtifact): Promise<void>;
}

/** Everything a use case may reach for, assembled at the composition root. */
export interface Repositories {
  readonly articles: ArticleRepository;
  readonly revisions: RevisionRepository;
  readonly embeds: EmbedRepository;
  readonly routes: RouteRepository;
  readonly locations: LocationRepository;
  readonly places: PlaceRepository;
  readonly media: MediaRepository;
  readonly taxonomy: TaxonomyRepository;
  readonly relations: RelationRepository;
  readonly authors: AuthorRepository;
  readonly aiArtifacts: AIArtifactRepository;
}
