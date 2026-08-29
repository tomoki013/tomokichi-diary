import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { currentSchemaVersion, migrate, type Migration } from "../migrator.js";
import { fromNodeSqlite, openInMemoryDatabase } from "../node-sqlite.js";

const MIGRATIONS_DIR = join(process.cwd(), "migrations");

function loadMigrations(): Migration[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .toSorted()
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name), "utf8") }));
}

describe("migrations", () => {
  it("takes an empty database to the latest schema", async () => {
    const db = fromNodeSqlite(openInMemoryDatabase());
    const result = await migrate(db, loadMigrations());

    expect(result.applied).toEqual(loadMigrations().map((m) => m.name));
    expect(await currentSchemaVersion(db)).toBe(loadMigrations().at(-1)?.name);
  });

  it("is idempotent: reapplying changes nothing", async () => {
    const db = fromNodeSqlite(openInMemoryDatabase());
    await migrate(db, loadMigrations());
    const second = await migrate(db, loadMigrations());
    expect(second.applied).toEqual([]);
  });

  it("applies a newly appended migration to an existing schema", async () => {
    const db = fromNodeSqlite(openInMemoryDatabase());
    await migrate(db, loadMigrations());

    const next: Migration = {
      name: "9999_test_append.sql",
      sql: "CREATE TABLE probe (id TEXT PRIMARY KEY)",
    };
    const result = await migrate(db, [...loadMigrations(), next]);
    expect(result.applied).toEqual([next.name]);
  });

  it("creates every table the row mappers write to", async () => {
    const sqlite = openInMemoryDatabase();
    await migrate(fromNodeSqlite(sqlite), loadMigrations());
    const tables = new Set(
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => String(row["name"])),
    );
    for (const table of [
      "authors",
      "articles",
      "article_revisions",
      "article_embeds",
      "routes",
      "locations",
      "location_names",
      "places",
      "media_assets",
      "article_media",
      "categories",
      "tags",
      "article_locations",
      "article_places",
      "article_categories",
      "article_tags",
      "ai_artifacts",
    ]) {
      expect(tables).toContain(table);
    }
  });
});
