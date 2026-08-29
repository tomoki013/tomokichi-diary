import type { SqlDatabase } from "./sql.js";

export interface Migration {
  readonly name: string;
  readonly sql: string;
}

/**
 * Append-only migrations, applied in filename order and recorded so a rerun is
 * a no-op. Nothing here rewrites history: an applied file is never edited
 * (instruction §49).
 */
const LEDGER = `CREATE TABLE IF NOT EXISTS schema_migrations (
  name        TEXT PRIMARY KEY,
  applied_at  TEXT NOT NULL
)`;

export interface MigrationResult {
  readonly applied: readonly string[];
  readonly alreadyApplied: readonly string[];
}

export async function migrate(
  db: SqlDatabase,
  migrations: readonly Migration[],
  now: () => string = () => new Date().toISOString(),
): Promise<MigrationResult> {
  await db.exec(LEDGER);
  const rows = await db.prepare("SELECT name FROM schema_migrations").all<{ name: string }>();
  const done = new Set(rows.map((row) => row.name));

  const applied: string[] = [];
  for (const migration of migrations.toSorted((a, b) => a.name.localeCompare(b.name))) {
    if (done.has(migration.name)) continue;
    await db.exec(migration.sql);
    await db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").bind(migration.name, now()).run();
    applied.push(migration.name);
  }

  return { applied, alreadyApplied: [...done] };
}

export async function currentSchemaVersion(db: SqlDatabase): Promise<string | null> {
  await db.exec(LEDGER);
  const row = await db.prepare("SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1").first<{ name: string }>();
  return row?.name ?? null;
}
