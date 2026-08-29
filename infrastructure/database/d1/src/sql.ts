/**
 * The narrowest SQL surface the repositories need. D1 satisfies it directly;
 * so does `node:sqlite` and any driver we might move to, which is what keeps
 * the database swappable (instruction §28).
 */
export interface SqlStatement {
  bind(...values: readonly unknown[]): SqlStatement;
  all<T = Record<string, unknown>>(): Promise<T[]>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<void>;
}

export interface SqlDatabase {
  prepare(sql: string): SqlStatement;
  /** Applied atomically where the driver supports it. */
  batch(statements: readonly SqlStatement[]): Promise<void>;
  exec(sql: string): Promise<void>;
}

/** Cloudflare D1 exposes this shape already; the wrapper only narrows it. */
export interface D1Like {
  prepare(sql: string): {
    bind(...values: unknown[]): unknown;
    all(): Promise<{ results?: unknown[] }>;
    first(): Promise<unknown>;
    run(): Promise<unknown>;
  };
  batch(statements: unknown[]): Promise<unknown>;
  exec(sql: string): Promise<unknown>;
}

export function fromD1(db: D1Like): SqlDatabase {
  const wrap = (statement: ReturnType<D1Like["prepare"]>): SqlStatement => ({
    bind: (...values) => wrap(statement.bind(...values) as ReturnType<D1Like["prepare"]>),
    all: async <T>() => ((await statement.all()).results ?? []) as T[],
    first: async <T>() => ((await statement.first()) ?? null) as T | null,
    run: async () => {
      await statement.run();
    },
    // The native statement is carried so `batch` can hand D1 back its own object.
    ...({ native: statement } as Record<string, unknown>),
  });

  return {
    prepare: (sql) => wrap(db.prepare(sql)),
    batch: async (statements) => {
      await db.batch(statements.map((s) => (s as unknown as { native: unknown }).native));
    },
    exec: async (sql) => {
      await db.exec(sql);
    },
  };
}
