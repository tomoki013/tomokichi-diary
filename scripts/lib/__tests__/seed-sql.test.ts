import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { loadSnapshot } from "../built-site.js";
import { SEED_KEYS, buildSeedSql } from "../seed-sql.js";

const MIGRATIONS = join(process.cwd(), "migrations");

/** A database shaped like production D1: every migration, foreign keys on. */
function migratedDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  for (const file of readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .toSorted()) {
    db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  }
  return db;
}

const count = (db: DatabaseSync, table: string): number =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe("seed SQL", () => {
  const sql = buildSeedSql(loadSnapshot());

  it("upserts on each table's real primary key", () => {
    const db = migratedDatabase();
    for (const [table, keys] of Object.entries(SEED_KEYS)) {
      const pk = (
        db.prepare(`SELECT name, pk FROM pragma_table_info(?) WHERE pk > 0`).all(table) as Array<{
          name: string;
          pk: number;
        }>
      )
        .toSorted((a, b) => a.pk - b.pk)
        .map((column) => column.name);
      expect(pk, table).toEqual(keys);
    }
  });

  it("reseeding keeps rows the export does not carry, such as reader likes", () => {
    const db = migratedDatabase();
    db.exec(sql);
    const articles = count(db, "articles");
    db.exec(
      "INSERT INTO article_likes (article_id, visitor_hash, created_at) " +
        "SELECT id, 'visitor', '2026-09-23T00:00:00.000Z' FROM articles",
    );
    expect(count(db, "article_likes")).toBe(articles);

    // INSERT OR REPLACE deleted each article first, and the cascade took
    // every like with it.
    db.exec(sql);

    expect(count(db, "article_likes")).toBe(articles);
    expect(count(db, "articles")).toBe(articles);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("brings a drifted row back to the export", () => {
    const db = migratedDatabase();
    db.exec(sql);
    const { id } = db.prepare("SELECT id FROM articles LIMIT 1").get() as { id: string };
    const original = db.prepare("SELECT updated_at FROM articles WHERE id = ?").get(id);
    db.prepare("UPDATE articles SET updated_at = 'drifted' WHERE id = ?").run(id);

    db.exec(sql);

    expect(db.prepare("SELECT updated_at FROM articles WHERE id = ?").get(id)).toEqual(original);
  });
});
