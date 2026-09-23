import {
  articleCategoryRow,
  articleCollectionRow,
  articleLocationRow,
  articleMediaRow,
  articlePlaceRow,
  articleRow,
  articleTagRow,
  authorRow,
  categoryRow,
  collectionRow,
  embedRow,
  locationNameRow,
  locationRow,
  mediaRow,
  placeRow,
  revisionRow,
  routeRow,
  tagRow,
  sourceReferenceRow,
  travelRouteRow,
  travelFactRow,
  articleKnowledgeRow,
  type ContentSnapshot,
  type Row,
} from "@tomokichi/data";

/**
 * The seed as SQL. Nothing here is D1-specific -- the same statements load into
 * SQLite or Postgres.
 *
 * Every row is an upsert on the table's primary key, never `INSERT OR REPLACE`.
 * REPLACE deletes the conflicting row before inserting, and with foreign keys
 * on that delete cascades: reseeding production used to wipe every reader's
 * like (`article_likes`) and any admin revision not in the export. An upsert
 * updates in place, so rows the export does not know about survive. A clash on
 * some other unique column (a route path now owned by a different id, say)
 * fails the statement instead of silently deleting the other row.
 */

/** Primary key per seeded table; must match `migrations/` (the seed test checks). */
export const SEED_KEYS = {
  authors: ["id"],
  media_assets: ["id"],
  locations: ["id"],
  location_names: ["location_id", "locale"],
  places: ["id"],
  categories: ["id"],
  tags: ["id"],
  collections: ["id"],
  articles: ["id"],
  article_revisions: ["id"],
  article_embeds: ["id"],
  routes: ["id"],
  article_media: ["article_id", "media_id", "role"],
  article_locations: ["article_id", "location_id", "relation"],
  article_places: ["article_id", "place_id", "relation"],
  article_categories: ["article_id", "category_id"],
  article_tags: ["article_id", "tag_id"],
  article_collections: ["article_id", "collection_id"],
  source_references: ["id"],
  travel_routes: ["id"],
  travel_facts: ["id"],
  article_knowledge: ["article_id", "revision_id"],
} as const satisfies Record<string, readonly string[]>;

export type SeedTable = keyof typeof SEED_KEYS;

function literal(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

/** Statements are capped by size, not row count: article bodies are large. */
const MAX_STATEMENT_BYTES = 20_000;

function upsert(table: SeedTable, rows: readonly Row[]): string[] {
  if (rows.length === 0) return [];
  const columns = Object.keys(rows[0]!);
  const keys: readonly string[] = SEED_KEYS[table];
  const updates = columns.filter((column) => !keys.includes(column));
  const prefix = `INSERT INTO ${table} (${columns.join(", ")}) VALUES`;
  const suffix =
    updates.length === 0
      ? `ON CONFLICT (${keys.join(", ")}) DO NOTHING`
      : `ON CONFLICT (${keys.join(", ")}) DO UPDATE SET ${updates
          .map((column) => `${column} = excluded.${column}`)
          .join(", ")}`;

  const statements: string[] = [];
  let batch: string[] = [];
  let bytes = 0;

  const flush = (): void => {
    if (batch.length === 0) return;
    statements.push(`${prefix}\n  ${batch.join(",\n  ")}\n${suffix};`);
    batch = [];
    bytes = 0;
  };

  for (const row of rows) {
    const tuple = `(${columns.map((column) => literal(row[column])).join(", ")})`;
    if (batch.length > 0 && bytes + tuple.length > MAX_STATEMENT_BYTES) flush();
    batch.push(tuple);
    bytes += tuple.length;
  }
  flush();
  return statements;
}

export function buildSeedSql(snapshot: ContentSnapshot): string {
  // Ordered so foreign keys always resolve.
  return [
    "PRAGMA defer_foreign_keys = true;",
    ...upsert("authors", snapshot.authors.map(authorRow.from)),
    ...upsert("media_assets", snapshot.media.map(mediaRow.from)),
    ...upsert("locations", snapshot.locations.map(locationRow.from)),
    ...upsert("location_names", snapshot.locationNames.map(locationNameRow.from)),
    ...upsert("places", snapshot.places.map(placeRow.from)),
    ...upsert("categories", snapshot.categories.map(categoryRow.from)),
    ...upsert("tags", snapshot.tags.map(tagRow.from)),
    ...upsert("collections", snapshot.collections.map(collectionRow.from)),
    ...upsert("articles", snapshot.articles.map(articleRow.from)),
    ...upsert("article_revisions", snapshot.revisions.map(revisionRow.from)),
    ...upsert("article_embeds", snapshot.embeds.map(embedRow.from)),
    ...upsert("routes", snapshot.routes.map(routeRow.from)),
    ...upsert("article_media", snapshot.articleMedia.map(articleMediaRow.from)),
    ...upsert("article_locations", snapshot.articleLocations.map(articleLocationRow.from)),
    ...upsert("article_places", snapshot.articlePlaces.map(articlePlaceRow.from)),
    ...upsert("article_categories", snapshot.articleCategories.map(articleCategoryRow.from)),
    ...upsert("article_tags", snapshot.articleTags.map(articleTagRow.from)),
    ...upsert("article_collections", snapshot.articleCollections.map(articleCollectionRow.from)),
    ...upsert("source_references", snapshot.sources.map(sourceReferenceRow.from)),
    ...upsert("travel_routes", snapshot.travelRoutes.map(travelRouteRow.from)),
    ...upsert("travel_facts", snapshot.travelFacts.map(travelFactRow.from)),
    ...upsert("article_knowledge", snapshot.articleKnowledge.map(articleKnowledgeRow.from)),
  ].join("\n");
}
