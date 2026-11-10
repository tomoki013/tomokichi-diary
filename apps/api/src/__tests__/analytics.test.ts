import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { createTestContext } from "@tomokichi/infra-d1/testing-context";
import { openInMemoryDatabase } from "@tomokichi/infra-d1/testing";
import { createApp } from "../app.js";
import type { Env } from "../env.js";
async function fixture() {
  const db = openInMemoryDatabase();
  db.exec(readFileSync("migrations/0015_analytics.sql", "utf8"));
  db.exec(readFileSync("migrations/0016_analytics_period_counts.sql", "utf8"));
  const DB = {
    prepare: (sql: string) => {
      let params: never[] = [];
      const statement = {
        bind: (...values: never[]) => {
          params = values;
          return statement;
        },
        all: async () => ({ results: db.prepare(sql).all(...params) }),
        first: async () => db.prepare(sql).get(...params),
        run: async () => db.prepare(sql).run(...params),
      };
      return statement;
    },
  };
  const context = await createTestContext();
  const app = createApp({
    contextFactory: () => context,
    verifyAccess: async () => ({ subject: "operator", email: "test@example.com" }),
  });
  const env = {
    DB,
    ADMIN_TOKEN: "test",
    ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com",
    ACCESS_AUD: "aud",
  } as unknown as Env;
  return { app, env, db };
}

/** Thirty search queries a day for a week, plus GA4 site totals and one saved weekly report. */
function seed(db: Awaited<ReturnType<typeof fixture>>["db"]) {
  const insert = db.prepare("INSERT INTO analytics_days(source,date,payload) VALUES (?,?,?)");
  for (let day = 5; day <= 11; day++) {
    const date = `2026-10-${String(day).padStart(2, "0")}`;
    const base = { date, retrievedAt: "2026-10-20T00:00:00.000Z", provisional: false };
    insert.run(
      "ga4",
      date,
      JSON.stringify({
        ...base,
        source: "ga4",
        rows: [
          { grain: "site", key: "site", path: null, articleId: null, metrics: { pageViews: 100 } },
        ],
      }),
    );
    insert.run(
      "gsc_url",
      date,
      JSON.stringify({
        ...base,
        source: "gsc_url",
        rows: Array.from({ length: 30 }, (_, i) => ({
          grain: "query",
          key: `query ${i}`,
          path: "/posts/a",
          articleId: null,
          metrics: { clicks: 30 - i, impressions: 100, positionSum: 300 },
        })),
      }),
    );
  }
  db.prepare(
    "INSERT INTO analytics_reports(period,start,end,generated_at,payload) VALUES (?,?,?,?,?)",
  ).run(
    "weekly",
    "2026-10-05",
    "2026-10-11",
    "2026-10-12T07:00:00.000Z",
    JSON.stringify({ big: "x".repeat(1000) }),
  );
}
afterEach(() => vi.unstubAllGlobals());
describe("private analytics HTTP boundary", () => {
  it("requires a verified Access identity rather than a shared admin token for ChatGPT consent", async () => {
    const { app, env } = await fixture();
    const path = "/v1/admin/analytics/connection-identity";
    expect(
      (await app.request(path, { headers: { authorization: "Bearer test" } }, env)).status,
    ).toBe(401);
    const res = await app.request(path, { headers: { "cf-access-jwt-assertion": "signed" } }, env);
    expect(await res.json()).toEqual({ subject: "operator" });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
  it("requires authentication; no public counterpart; Access token can read empty data without exposing secrets", async () => {
    const { app, env } = await fixture();
    const path = "/v1/admin/ops/analytics.dashboard";
    const body = JSON.stringify({ start: "2026-10-01", end: "2026-10-07" });
    expect((await app.request(path, { method: "POST", body }, env)).status).toBe(401);
    expect((await app.request("/v1/analytics", {}, env)).status).toBe(404);
    const res = await app.request(
      path,
      { method: "POST", body, headers: { "cf-access-jwt-assertion": "valid" } },
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const result = await res.json();
    expect(
      result.dashboard.current.every((s: { coveredDays: number }) => s.coveredDays === 0),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toContain("ADMIN_TOKEN");
  });
  it("rejects SQL injection and invalid periods before querying; unconfigured manual dispatch is explicit", async () => {
    const { app, env } = await fixture();
    const headers = { authorization: "Bearer test", "content-type": "application/json" };
    const op = (name: string, input: unknown) =>
      app.request(
        `/v1/admin/ops/${name}`,
        { method: "POST", headers, body: JSON.stringify(input) },
        env,
      );
    expect(
      (await op("analytics.dashboard", { start: "2026-02-30", end: "2026-03-01" })).status,
    ).toBe(400);
    expect(
      (await op("analytics.dashboard", { start: "x' OR 1=1--", end: "2026-03-01" })).status,
    ).toBe(400);
    const week = { start: "2026-10-01", end: "2026-10-07", scope: "all" };
    expect((await op("analytics.recollect", week)).status).toBe(503);
    const send = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", send);
    env.ANALYTICS_GITHUB_TOKEN = "private";
    const res = await op("analytics.recollect", week);
    expect(res.status).toBe(200);
    expect(send.mock.calls[0]?.[0]).toContain("tomoki013/tomokichi-diary");
    expect(JSON.parse(send.mock.calls[0]?.[1].body).ref).toBe("main");
    const counts = await op("analytics.recollect", {
      start: "2026-08-01",
      end: "2026-10-01",
      scope: "counts",
    });
    expect(counts.status).toBe(200);
    expect(send.mock.calls[1]?.[0]).toContain("analytics-periods.yml");
  });

  it("returns only the asked-for sections, says where a list was cut, and marks no data as null", async () => {
    const { app, env, db } = await fixture();
    seed(db);
    const headers = { authorization: "Bearer test", "content-type": "application/json" };
    const op = async (name: string, input: unknown) => {
      const res = await app.request(
        `/v1/admin/ops/${name}`,
        { method: "POST", headers, body: JSON.stringify(input) },
        env,
      );
      return { status: res.status, body: (await res.json()) as Record<string, any> };
    };
    const week = { start: "2026-10-05", end: "2026-10-11" };

    const full = (await op("analytics.dashboard", week)).body.dashboard;
    expect(full.experiments).toBeUndefined();
    expect(full.queries).toHaveLength(20);
    expect(full.lists.queries).toEqual({ total: 30, offset: 0, returned: 20 });
    expect(full.scope).toBe("site");
    expect(full.current.find((s: any) => s.source === "adsense").metrics).toBeNull();
    expect(full.current.find((s: any) => s.source === "ga4").metrics.pageViews).toBe(700);

    const next = (await op("analytics.dashboard", { ...week, sections: ["queries"], offset: 20 }))
      .body.dashboard;
    expect(next.queries.map((q: any) => q.key)).toEqual(
      Array.from({ length: 10 }, (_, i) => `query ${20 + i}`),
    );
    expect(next.daily).toBeUndefined();

    const headline = (await op("analytics.dashboard", { ...week, sections: [] })).body.dashboard;
    expect(Object.keys(headline).toSorted()).toEqual(
      ["current", "lists", "previous", "previousRange", "range", "scope", "statuses"].toSorted(),
    );

    const list = (await op("analytics.savedReports", {})).body;
    expect(list.items).toEqual([
      {
        period: "weekly",
        start: "2026-10-05",
        end: "2026-10-11",
        generatedAt: "2026-10-12T07:00:00.000Z",
      },
    ]);

    const report = (
      await op("analytics.report", { period: "weekly", start: "2026-10-05", sections: [] })
    ).body;
    expect(report.range).toEqual(week);
    expect(report.snapshot).toEqual({ state: "saved", generatedAt: "2026-10-12T07:00:00.000Z" });
    const withSnapshot = (
      await op("analytics.report", { period: "weekly", start: "2026-10-05", includeSnapshot: true })
    ).body;
    expect(withSnapshot.snapshot.data).toEqual({ big: "x".repeat(1000) });
    expect((await op("analytics.report", { period: "weekly", start: "2026-10-06" })).status).toBe(
      400,
    );
    expect((await op("analytics.report", { period: "monthly", start: "2026-10-05" })).status).toBe(
      400,
    );
    expect(
      (await op("analytics.report", { period: "monthly", start: "2026-10-01" })).body.range,
    ).toEqual({ start: "2026-10-01", end: "2026-10-31" });
  });
});
