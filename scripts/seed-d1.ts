import { writeFileSync } from "node:fs";
import { join } from "node:path";
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
  type Row,
} from "@tomokichi/data";
import { loadSnapshot } from "./lib/built-site.js";

/**
 * Turns the committed export into SQL, so a fresh database can be filled from
 * the repository alone. Nothing here is D1-specific beyond the file it writes —
 * the same statements load into SQLite or Postgres.
 *
 *   pnpm exec tsx scripts/seed-d1.ts
 *   wrangler d1 execute tomokichi-diary --remote --file=.artifacts/seed.sql
 */
const OUT = join(process.cwd(), ".artifacts", "seed.sql");

function literal(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

/** Statements are capped by size, not row count: article bodies are large. */
const MAX_STATEMENT_BYTES = 20_000;

function insert(table: string, rows: readonly Row[]): string[] {
  if (rows.length === 0) return [];
  const columns = Object.keys(rows[0]!);
  const prefix = `INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES`;

  const statements: string[] = [];
  let batch: string[] = [];
  let bytes = 0;

  const flush = (): void => {
    if (batch.length === 0) return;
    statements.push(`${prefix}\n  ${batch.join(",\n  ")};`);
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

const snapshot = loadSnapshot();

// Ordered so foreign keys always resolve.
const sql = [
  "PRAGMA defer_foreign_keys = true;",
  ...insert("authors", snapshot.authors.map(authorRow.from)),
  ...insert("media_assets", snapshot.media.map(mediaRow.from)),
  ...insert("locations", snapshot.locations.map(locationRow.from)),
  ...insert("location_names", snapshot.locationNames.map(locationNameRow.from)),
  ...insert("places", snapshot.places.map(placeRow.from)),
  ...insert("categories", snapshot.categories.map(categoryRow.from)),
  ...insert("tags", snapshot.tags.map(tagRow.from)),
  ...insert("collections", snapshot.collections.map(collectionRow.from)),
  ...insert("articles", snapshot.articles.map(articleRow.from)),
  ...insert("article_revisions", snapshot.revisions.map(revisionRow.from)),
  ...insert("article_embeds", snapshot.embeds.map(embedRow.from)),
  ...insert("routes", snapshot.routes.map(routeRow.from)),
  ...insert("article_media", snapshot.articleMedia.map(articleMediaRow.from)),
  ...insert("article_locations", snapshot.articleLocations.map(articleLocationRow.from)),
  ...insert("article_places", snapshot.articlePlaces.map(articlePlaceRow.from)),
  ...insert("article_categories", snapshot.articleCategories.map(articleCategoryRow.from)),
  ...insert("article_tags", snapshot.articleTags.map(articleTagRow.from)),
  ...insert("article_collections", snapshot.articleCollections.map(articleCollectionRow.from)),
].join("\n");

writeFileSync(OUT, `${sql}\n`);
process.stdout.write(
  `✓ seed ${OUT} | articles ${snapshot.articles.length} | routes ${snapshot.routes.length} | media ${snapshot.media.length}\n`,
);
