import { describe, expect, it } from "vitest";
import { currentSchemaVersion, migrate, type Migration } from "../migrator.js";
import { fromNodeSqlite, openInMemoryDatabase } from "../node-sqlite.js";
import { loadMigrations } from "./context.js";

describe("migrations", () => {
  it("takes an empty database to the latest schema, then applies only what is appended", async () => {
    const db = fromNodeSqlite(openInMemoryDatabase());
    const result = await migrate(db, loadMigrations());
    expect(result.applied).toEqual(loadMigrations().map((m) => m.name));
    expect(await currentSchemaVersion(db)).toBe(loadMigrations().at(-1)?.name);

    const next: Migration = {
      name: "9999_test_append.sql",
      sql: "CREATE TABLE probe (id TEXT PRIMARY KEY)",
    };
    expect((await migrate(db, [...loadMigrations(), next])).applied).toEqual([next.name]);
  });
});
