import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { AppContext } from "@tomokichi/application";
import { fixedClock, silentLogger } from "@tomokichi/application";
import { instantFrom, type AuthorId } from "@tomokichi/domain";
import { createMediaUrlResolver, createMemoryStorage } from "@tomokichi/infra-r2";
import { migrate, type Migration } from "../migrator.js";
import { fromNodeSqlite, openInMemoryDatabase } from "../node-sqlite.js";
import { createRepositories } from "../repositories.js";

export function loadMigrations(): Migration[] {
  const dir = join(process.cwd(), "migrations");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .toSorted()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") }));
}

/** A full application context backed by in-memory SQLite and in-memory object storage. */
export async function createTestContext(now = "2026-08-30T00:00:00.000Z"): Promise<AppContext> {
  const db = fromNodeSqlite(openInMemoryDatabase());
  await migrate(db, loadMigrations());

  const repos = createRepositories(db);
  // Every article references an author, so the fixture author exists from the start.
  await repos.authors.save({ id: "author-tomokichi" as AuthorId, name: "ともきち", url: null, bio: null });

  let counter = 0;
  return {
    repos,
    clock: fixedClock(instantFrom(now)),
    ids: { next: <T extends string>() => `id-${String(++counter).padStart(4, "0")}` as T },
    logger: silentLogger,
    storage: createMemoryStorage(),
    mediaUrls: createMediaUrlResolver("https://media.tomokichidiary.com"),
    ai: null,
  };
}
