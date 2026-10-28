import type { SqlDatabase, SqlStatement } from "@tomokichi/infra-d1";

interface Query {
  sql: string;
  params: readonly unknown[];
}
/** Build tooling uses the same repositories against D1's REST adapter. */
export function remoteDatabase(): SqlDatabase {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const database = process.env.D1_DATABASE_ID ?? "b799453b-ada9-454e-81dc-26999c2c29db";
  if (!account || !token) throw new Error("Cloudflare build credentials are required");
  const queryResults = async (input: Query | readonly Query[]): Promise<unknown[][]> => {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(Array.isArray(input) ? { batch: input } : input),
        signal: AbortSignal.timeout(30000),
      },
    );
    const body = (await response.json()) as {
      success: boolean;
      result?: { success: boolean; results?: unknown[] }[];
    };
    if (!response.ok || !body.success || body.result?.some((r) => !r.success))
      throw new Error(`D1 query failed (HTTP ${response.status})`);
    return body.result?.map((r) => r.results ?? []) ?? [];
  };
  const query = async (input: Query | readonly Query[]) => (await queryResults(input)).flat();
  // Snapshot loading fans out over every revision/embed/photo association.
  // Coalesce only SELECT reads in the same turn, keeping explicit writes and
  // transactions unchanged and preserving each query's own result boundary.
  const reads: {
    input: Query;
    resolve: (rows: unknown[]) => void;
    reject: (error: unknown) => void;
  }[] = [];
  let scheduled = false;
  const flushReads = async () => {
    const pending = reads.splice(0);
    scheduled = false;
    // D1 takes at most 50 statements per batch; larger turns go out as
    // concurrent batches instead of waiting on each other.
    const groups: (typeof pending)[] = [];
    for (let offset = 0; offset < pending.length; offset += 50)
      groups.push(pending.slice(offset, offset + 50));
    try {
      await Promise.all(
        groups.map(async (group) => {
          const results = await queryResults(
            group.length === 1 ? group[0]!.input : group.map((item) => item.input),
          );
          if (group.length > 1 && results.length !== group.length)
            throw new Error("Incomplete D1 read batch");
          for (const [index, item] of group.entries())
            item.resolve(group.length === 1 ? results.flat() : results[index]!);
        }),
      );
    } catch (error) {
      for (const item of pending) item.reject(error);
    }
  };
  const read = (input: Query): Promise<unknown[]> => {
    if (!/^\s*SELECT\b/i.test(input.sql)) return query(input);
    return new Promise((resolve, reject) => {
      reads.push({ input, resolve, reject });
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(() => {
          void flushReads();
        });
      }
    });
  };
  const statement = (
    sql: string,
    params: readonly unknown[] = [],
  ): SqlStatement & { query: Query } => ({
    query: { sql, params },
    bind: (...values) => statement(sql, values),
    all: async <T>() => (await read({ sql, params })) as T[],
    first: async <T>() => ((await read({ sql, params }))[0] as T) ?? null,
    run: async () => {
      await query({ sql, params });
    },
  });
  return {
    prepare: (sql) => statement(sql),
    exec: async (sql) => {
      await query({ sql, params: [] });
    },
    batch: async (statements) => {
      await query(statements.map((s) => (s as SqlStatement & { query: Query }).query));
    },
  };
}
