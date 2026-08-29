import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AppContext } from "@tomokichi/application";
import { silentLogger, systemClock, uuidV7Generator } from "@tomokichi/application";
import { createRepositories, migrate, type Migration } from "@tomokichi/infra-d1";
import { fromNodeSqlite } from "@tomokichi/infra-d1/testing";
import { createMediaUrlResolver, createMemoryStorage } from "@tomokichi/infra-r2";

/**
 * Local authoring database. Production runs the same schema and repositories on
 * D1; this file only decides where the bytes live during development and in the
 * import/export tooling.
 */
export const LOCAL_DB_PATH = join(process.cwd(), ".data", "tomokichi.db");

export function loadMigrations(): Migration[] {
  const dir = join(process.cwd(), "migrations");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .toSorted()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") }));
}

export async function openLocalDatabase(path = LOCAL_DB_PATH) {
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  const sqlite = new DatabaseSync(path);
  sqlite.exec("PRAGMA foreign_keys = ON");
  const db = fromNodeSqlite(sqlite);
  await migrate(db, loadMigrations());
  return { sqlite, db };
}

export async function createLocalContext(path = LOCAL_DB_PATH): Promise<AppContext> {
  const { db } = await openLocalDatabase(path);
  return {
    repos: createRepositories(db),
    clock: systemClock,
    ids: uuidV7Generator,
    logger: silentLogger,
    // Media bytes live in R2 in production; the tooling only records keys.
    storage: createMemoryStorage(),
    mediaUrls: createMediaUrlResolver(process.env.PUBLIC_MEDIA_URL ?? "https://media.tomokichidiary.com"),
    ai: null,
  };
}
