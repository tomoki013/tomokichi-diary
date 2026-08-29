import { DatabaseSync } from "node:sqlite";
import type { SqlDatabase, SqlStatement } from "./sql.js";

/**
 * `node:sqlite` implementation of the same SQL surface, used by tests, the
 * import/export tooling and local development. It is a separate entry point so
 * nothing Node-specific is ever bundled into the Worker.
 */
export function fromNodeSqlite(db: DatabaseSync): SqlDatabase {
  const make = (sql: string, bound: readonly unknown[] = []): SqlStatement => ({
    bind: (...values) => make(sql, [...bound, ...values]),
    all: async <T>() => db.prepare(sql).all(...(bound as never[])) as T[],
    first: async <T>() => (db.prepare(sql).get(...(bound as never[])) ?? null) as T | null,
    run: async () => {
      db.prepare(sql).run(...(bound as never[]));
    },
  });

  return {
    prepare: (sql) => make(sql),
    batch: async (statements) => {
      db.exec("BEGIN");
      try {
        for (const statement of statements) await statement.run();
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    exec: async (sql) => {
      db.exec(sql);
    },
  };
}

export function openInMemoryDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}
