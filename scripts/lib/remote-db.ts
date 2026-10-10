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
  const query = async (input: Query | readonly Query[]): Promise<unknown[]> => {
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
    return body.result?.flatMap((r) => r.results ?? []) ?? [];
  };
  const statement = (
    sql: string,
    params: readonly unknown[] = [],
  ): SqlStatement & { query: Query } => ({
    query: { sql, params },
    bind: (...values) => statement(sql, values),
    all: async <T>() => (await query({ sql, params })) as T[],
    first: async <T>() => ((await query({ sql, params }))[0] as T) ?? null,
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
