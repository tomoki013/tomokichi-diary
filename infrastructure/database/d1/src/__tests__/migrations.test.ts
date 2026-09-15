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
});
