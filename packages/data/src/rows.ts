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
  ArticleCollection,
  Collection,
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
 * Row ↔ entity mapping. Deliberately generic: a row is a plain object, so this
 * file works for D1, SQLite, Postgres or a JSON fixture without importing any
 * driver (instruction §13).
 */
export type Row = Record<string, unknown>;

const str = (row: Row, key: string): string => String(row[key] ?? "");
const nullableStr = (row: Row, key: string): string | null => {
  const value = row[key];
  return value === null || value === undefined || value === "" ? null : String(value);
};
const num = (row: Row, key: string): number => Number(row[key] ?? 0);
const nullableNum = (row: Row, key: string): number | null => {
  const value = row[key];
  return value === null || value === undefined ? null : Number(value);
};
/** SQLite has no boolean type; 0/1 round-trips through every target database. */
const bool = (row: Row, key: string): boolean =>
  row[key] === 1 || row[key] === true || row[key] === "1";
const flag = (value: boolean): number => (value ? 1 : 0);
const json = <T>(row: Row, key: string, fallback: T): T => {
  const value = row[key];
  if (typeof value !== "string" || value === "") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

export const articleRow = {
  to: (row: Row): Article => ({
    id: str(row, "id") as Article["id"],
    kind: (str(row, "kind") || "article") as Article["kind"],
    status: str(row, "status") as Article["status"],
    locale: str(row, "locale") as Article["locale"],
    slug: str(row, "slug") as Article["slug"],
    authorId: str(row, "author_id") as Article["authorId"],
    currentRevisionId: nullableStr(row, "current_revision_id") as Article["currentRevisionId"],
    publishedRevisionId: nullableStr(
      row,
      "published_revision_id",
    ) as Article["publishedRevisionId"],
    createdAt: str(row, "created_at") as Article["createdAt"],
    updatedAt: str(row, "updated_at") as Article["updatedAt"],
    scheduledAt: nullableStr(row, "scheduled_at") as Article["scheduledAt"],
    publishedAt: nullableStr(row, "published_at") as Article["publishedAt"],
    archivedAt: nullableStr(row, "archived_at") as Article["archivedAt"],
    noindex: bool(row, "noindex"),
    travelStartDate: nullableStr(row, "travel_start_date") as Article["travelStartDate"],
    travelEndDate: nullableStr(row, "travel_end_date") as Article["travelEndDate"],
  }),
  from: (article: Article): Row => ({
    id: article.id,
    kind: article.kind,
    status: article.status,
    locale: article.locale,
    slug: article.slug,
    author_id: article.authorId,
    current_revision_id: article.currentRevisionId,
    published_revision_id: article.publishedRevisionId,
    created_at: article.createdAt,
    updated_at: article.updatedAt,
    scheduled_at: article.scheduledAt,
    published_at: article.publishedAt,
    archived_at: article.archivedAt,
    noindex: flag(article.noindex),
    travel_start_date: article.travelStartDate,
    travel_end_date: article.travelEndDate,
  }),
};

export const revisionRow = {
  to: (row: Row): ArticleRevision => ({
    id: str(row, "id") as ArticleRevision["id"],
    articleId: str(row, "article_id") as ArticleRevision["articleId"],
    revisionNumber: num(row, "revision_number"),
    title: str(row, "title"),
    summary: str(row, "summary"),
    bodyMarkdown: str(row, "body_markdown"),
    seoTitleOverride: nullableStr(row, "seo_title_override"),
    seoDescriptionOverride: nullableStr(row, "seo_description_override"),
    changeSummary: nullableStr(row, "change_summary"),
    createdAt: str(row, "created_at") as ArticleRevision["createdAt"],
    createdBy: str(row, "created_by") as ArticleRevision["createdBy"],
  }),
  from: (revision: ArticleRevision): Row => ({
    id: revision.id,
    article_id: revision.articleId,
    revision_number: revision.revisionNumber,
    title: revision.title,
    summary: revision.summary,
    body_markdown: revision.bodyMarkdown,
    seo_title_override: revision.seoTitleOverride,
    seo_description_override: revision.seoDescriptionOverride,
    change_summary: revision.changeSummary,
    created_at: revision.createdAt,
    created_by: revision.createdBy,
  }),
};

export const embedRow = {
  to: (row: Row): ArticleEmbed => ({
    id: str(row, "id"),
    revisionId: str(row, "revision_id") as ArticleEmbed["revisionId"],
    anchorKey: str(row, "anchor_key"),
    type: str(row, "type") as ArticleEmbed["type"],
    schemaVersion: num(row, "schema_version"),
    payload: json<Record<string, unknown>>(row, "payload", {}),
  }),
  from: (embed: ArticleEmbed): Row => ({
    id: embed.id,
    revision_id: embed.revisionId,
    anchor_key: embed.anchorKey,
    type: embed.type,
    schema_version: embed.schemaVersion,
    payload: JSON.stringify(embed.payload),
  }),
};

export const routeRow = {
  to: (row: Row): Route => ({
    id: str(row, "id") as Route["id"],
    path: str(row, "path") as Route["path"],
    locale: str(row, "locale") as Route["locale"],
    targetType: str(row, "target_type") as Route["targetType"],
    targetId: nullableStr(row, "target_id"),
    isCanonical: bool(row, "is_canonical"),
    redirectTo: nullableStr(row, "redirect_to") as Route["redirectTo"],
    redirectStatus: nullableNum(row, "redirect_status") as Route["redirectStatus"],
    isLegacy: bool(row, "is_legacy"),
    noindex: bool(row, "noindex"),
  }),
  from: (route: Route): Row => ({
    id: route.id,
    path: route.path,
    locale: route.locale,
    target_type: route.targetType,
    target_id: route.targetId,
    is_canonical: flag(route.isCanonical),
    redirect_to: route.redirectTo,
    redirect_status: route.redirectStatus,
    is_legacy: flag(route.isLegacy),
    noindex: flag(route.noindex),
  }),
};

export const locationRow = {
  to: (row: Row): Location => ({
    id: str(row, "id") as Location["id"],
    slug: str(row, "slug") as Location["slug"],
    type: str(row, "type") as Location["type"],
    parentId: nullableStr(row, "parent_id") as Location["parentId"],
    countryCode: nullableStr(row, "country_code"),
    subdivisionCode: nullableStr(row, "subdivision_code"),
    latitude: nullableNum(row, "latitude"),
    longitude: nullableNum(row, "longitude"),
    timezone: nullableStr(row, "timezone"),
  }),
  from: (location: Location): Row => ({
    id: location.id,
    slug: location.slug,
    type: location.type,
    parent_id: location.parentId,
    country_code: location.countryCode,
    subdivision_code: location.subdivisionCode,
    latitude: location.latitude,
    longitude: location.longitude,
    timezone: location.timezone,
  }),
};

export const locationNameRow = {
  to: (row: Row): LocationName => ({
    locationId: str(row, "location_id") as LocationName["locationId"],
    locale: str(row, "locale") as LocationName["locale"],
    name: str(row, "name"),
    shortName: nullableStr(row, "short_name"),
    romanizedName: nullableStr(row, "romanized_name"),
  }),
  from: (name: LocationName): Row => ({
    location_id: name.locationId,
    locale: name.locale,
    name: name.name,
    short_name: name.shortName,
    romanized_name: name.romanizedName,
  }),
};

export const placeRow = {
  to: (row: Row): Place => ({
    id: str(row, "id") as Place["id"],
    slug: str(row, "slug") as Place["slug"],
    locationId: str(row, "location_id") as Place["locationId"],
    kind: str(row, "kind") as Place["kind"],
    name: str(row, "name"),
    address: nullableStr(row, "address"),
    latitude: nullableNum(row, "latitude"),
    longitude: nullableNum(row, "longitude"),
    officialUrl: nullableStr(row, "official_url"),
    status: str(row, "status") as Place["status"],
  }),
  from: (place: Place): Row => ({
    id: place.id,
    slug: place.slug,
    location_id: place.locationId,
    kind: place.kind,
    name: place.name,
    address: place.address,
    latitude: place.latitude,
    longitude: place.longitude,
    official_url: place.officialUrl,
    status: place.status,
  }),
};

export const mediaRow = {
  to: (row: Row): MediaAsset => ({
    id: str(row, "id") as MediaAsset["id"],
    storageKey: str(row, "storage_key"),
    mimeType: str(row, "mime_type"),
    width: nullableNum(row, "width"),
    height: nullableNum(row, "height"),
    size: num(row, "size"),
    sha256: str(row, "sha256"),
    createdAt: str(row, "created_at"),
  }),
  from: (asset: MediaAsset): Row => ({
    id: asset.id,
    storage_key: asset.storageKey,
    mime_type: asset.mimeType,
    width: asset.width,
    height: asset.height,
    size: asset.size,
    sha256: asset.sha256,
    created_at: asset.createdAt,
  }),
};

export const articleMediaRow = {
  to: (row: Row): ArticleMedia => ({
    articleId: str(row, "article_id") as ArticleMedia["articleId"],
    mediaId: str(row, "media_id") as ArticleMedia["mediaId"],
    role: str(row, "role") as ArticleMedia["role"],
    sortOrder: num(row, "sort_order"),
    alt: str(row, "alt"),
    caption: nullableStr(row, "caption"),
  }),
  from: (media: ArticleMedia): Row => ({
    article_id: media.articleId,
    media_id: media.mediaId,
    role: media.role,
    sort_order: media.sortOrder,
    alt: media.alt,
    caption: media.caption,
  }),
};

export const categoryRow = {
  to: (row: Row): Category => ({
    id: str(row, "id") as Category["id"],
    slug: str(row, "slug") as Category["slug"],
    name: str(row, "name"),
    description: nullableStr(row, "description"),
    sortOrder: num(row, "sort_order"),
  }),
  from: (category: Category): Row => ({
    id: category.id,
    slug: category.slug,
    name: category.name,
    description: category.description,
    sort_order: category.sortOrder,
  }),
};

export const tagRow = {
  to: (row: Row): Tag => ({
    id: str(row, "id") as Tag["id"],
    slug: str(row, "slug") as Tag["slug"],
    name: str(row, "name"),
  }),
  from: (tag: Tag): Row => ({ id: tag.id, slug: tag.slug, name: tag.name }),
};

export const authorRow = {
  to: (row: Row): Author => ({
    id: str(row, "id") as Author["id"],
    name: str(row, "name"),
    url: nullableStr(row, "url"),
    bio: nullableStr(row, "bio"),
  }),
  from: (author: Author): Row => ({
    id: author.id,
    name: author.name,
    url: author.url,
    bio: author.bio,
  }),
};

export const articleLocationRow = {
  to: (row: Row): ArticleLocation => ({
    articleId: str(row, "article_id") as ArticleLocation["articleId"],
    locationId: str(row, "location_id") as ArticleLocation["locationId"],
    relation: str(row, "relation") as ArticleLocation["relation"],
  }),
  from: (relation: ArticleLocation): Row => ({
    article_id: relation.articleId,
    location_id: relation.locationId,
    relation: relation.relation,
  }),
};

export const articlePlaceRow = {
  to: (row: Row): ArticlePlace => ({
    articleId: str(row, "article_id") as ArticlePlace["articleId"],
    placeId: str(row, "place_id") as ArticlePlace["placeId"],
    relation: str(row, "relation") as ArticlePlace["relation"],
  }),
  from: (relation: ArticlePlace): Row => ({
    article_id: relation.articleId,
    place_id: relation.placeId,
    relation: relation.relation,
  }),
};

export const articleCategoryRow = {
  to: (row: Row): ArticleCategory => ({
    articleId: str(row, "article_id") as ArticleCategory["articleId"],
    categoryId: str(row, "category_id") as ArticleCategory["categoryId"],
  }),
  from: (relation: ArticleCategory): Row => ({
    article_id: relation.articleId,
    category_id: relation.categoryId,
  }),
};

export const articleTagRow = {
  to: (row: Row): ArticleTag => ({
    articleId: str(row, "article_id") as ArticleTag["articleId"],
    tagId: str(row, "tag_id") as ArticleTag["tagId"],
  }),
  from: (relation: ArticleTag): Row => ({ article_id: relation.articleId, tag_id: relation.tagId }),
};

export const aiArtifactRow = {
  to: (row: Row): AIArtifact => ({
    id: str(row, "id") as AIArtifact["id"],
    entityType: str(row, "entity_type") as AIArtifact["entityType"],
    entityId: str(row, "entity_id"),
    sourceRevisionId: nullableStr(row, "source_revision_id") as AIArtifact["sourceRevisionId"],
    kind: str(row, "kind") as AIArtifact["kind"],
    content: json<Record<string, unknown>>(row, "content", {}),
    createdAt: str(row, "created_at") as AIArtifact["createdAt"],
    generator: str(row, "generator"),
  }),
  from: (artifact: AIArtifact): Row => ({
    id: artifact.id,
    entity_type: artifact.entityType,
    entity_id: artifact.entityId,
    source_revision_id: artifact.sourceRevisionId,
    kind: artifact.kind,
    content: JSON.stringify(artifact.content),
    created_at: artifact.createdAt,
    generator: artifact.generator,
  }),
};

export const collectionRow = {
  to: (row: Row): Collection => ({
    id: str(row, "id") as Collection["id"],
    slug: str(row, "slug") as Collection["slug"],
    kind: str(row, "kind") as Collection["kind"],
    title: str(row, "title"),
    description: nullableStr(row, "description"),
    coverMediaId: nullableStr(row, "cover_media_id") as Collection["coverMediaId"],
    startDate: nullableStr(row, "start_date") as Collection["startDate"],
    endDate: nullableStr(row, "end_date") as Collection["endDate"],
    sortOrder: num(row, "sort_order"),
  }),
  from: (collection: Collection): Row => ({
    id: collection.id,
    slug: collection.slug,
    kind: collection.kind,
    title: collection.title,
    description: collection.description,
    cover_media_id: collection.coverMediaId,
    start_date: collection.startDate,
    end_date: collection.endDate,
    sort_order: collection.sortOrder,
  }),
};

export const articleCollectionRow = {
  to: (row: Row): ArticleCollection => ({
    articleId: str(row, "article_id") as ArticleCollection["articleId"],
    collectionId: str(row, "collection_id") as ArticleCollection["collectionId"],
    sortOrder: num(row, "sort_order"),
  }),
  from: (relation: ArticleCollection): Row => ({
    article_id: relation.articleId,
    collection_id: relation.collectionId,
    sort_order: relation.sortOrder,
  }),
};
