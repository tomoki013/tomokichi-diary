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

  it("keeps stale collection URLs as redirects without moving current journey URLs", async () => {
    const db = fromNodeSqlite(openInMemoryDatabase());
    const migrations = loadMigrations();
    await migrate(
      db,
      migrations.filter((m) => m.name < "0012"),
    );
    await db.exec(`INSERT INTO routes (id, path, locale, target_type, target_id, is_canonical)
      VALUES ('old', '/collections/bangkok', 'ja', 'journey', 'trip-1', 1),
             ('current', '/trips/bangkok', 'ja', 'journey', 'trip-1', 1),
             ('unpaired', '/collections/other', 'ja', 'journey', 'trip-2', 1);`);
    await migrate(
      db,
      migrations.filter((m) => m.name < "0013"),
    );
    expect(
      await db
        .prepare(
          "SELECT path, target_type, is_canonical, redirect_to, redirect_status FROM routes WHERE id = 'old'",
        )
        .first(),
    ).toEqual({
      path: "/collections/bangkok",
      target_type: "redirect",
      is_canonical: 0,
      redirect_to: "/trips/bangkok",
      redirect_status: 301,
    });
    expect(
      await db.prepare("SELECT path, is_canonical FROM routes WHERE id = 'current'").first(),
    ).toEqual({ path: "/trips/bangkok", is_canonical: 1 });
    expect(
      await db
        .prepare("SELECT target_type, is_canonical FROM routes WHERE id = 'unpaired'")
        .first(),
    ).toEqual({ target_type: "journey", is_canonical: 1 });
  });

  it("restores the importer’s collection canonicals and redirects old trips without loops", async () => {
    const db = fromNodeSqlite(openInMemoryDatabase());
    const migrations = loadMigrations();
    await migrate(
      db,
      migrations.filter((m) => m.name < "0012"),
    );
    await db.exec(`INSERT INTO routes (id, path, locale, target_type, target_id, is_canonical)
      VALUES ('collection', '/collections/bangkok', 'ja', 'journey', 'trip-1', 1),
             ('trip', '/trips/bangkok', 'ja', 'journey', 'trip-1', 1),
             ('series', '/collections/series', 'ja', 'series', 'series-1', 1),
             ('unpaired', '/trips/other', 'ja', 'journey', 'trip-2', 1),
             ('other-language', '/trips/bangkok-en', 'en', 'journey', 'trip-1', 1);
      INSERT INTO routes (id, path, locale, target_type, is_canonical, redirect_to, redirect_status)
      VALUES ('alias', '/journey/bangkok', 'ja', 'redirect', 0, '/trips/bangkok', 301);`);
    await migrate(db, migrations);
    expect(
      await db
        .prepare(
          "SELECT target_type, target_id, is_canonical, redirect_to, redirect_status FROM routes WHERE id = 'collection'",
        )
        .first(),
    ).toEqual({
      target_type: "journey",
      target_id: "trip-1",
      is_canonical: 1,
      redirect_to: null,
      redirect_status: null,
    });
    for (const id of ["trip", "alias"])
      expect(
        await db
          .prepare(
            "SELECT target_type, is_canonical, redirect_to, redirect_status FROM routes WHERE id = ?",
          )
          .bind(id)
          .first(),
      ).toEqual({
        target_type: "redirect",
        is_canonical: 0,
        redirect_to: "/collections/bangkok",
        redirect_status: 301,
      });
    for (const id of ["series", "unpaired", "other-language"])
      expect(
        await db.prepare("SELECT is_canonical FROM routes WHERE id = ?").bind(id).first(),
      ).toEqual({ is_canonical: 1 });
    const before = await db.prepare("SELECT * FROM routes ORDER BY id").all();
    await db.exec(migrations.find((m) => m.name.startsWith("0013"))!.sql);
    expect(await db.prepare("SELECT * FROM routes ORDER BY id").all()).toEqual(before);
  });
});
