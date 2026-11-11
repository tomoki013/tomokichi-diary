import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { createTestContext } from "@tomokichi/infra-d1/testing-context";
import { openInMemoryDatabase } from "@tomokichi/infra-d1/testing";
import { analyticsReplacement } from "@tomokichi/infra-d1";
import type { AnalyticsDay } from "@tomokichi/application";
import { createApp } from "../app.js";
import type { Env } from "../env.js";
async function fixture() {
  const db = openInMemoryDatabase();
  db.exec(readFileSync("migrations/0015_analytics.sql", "utf8"));
  db.exec(readFileSync("migrations/0016_analytics_period_counts.sql", "utf8"));
  db.exec(readFileSync("migrations/0031_analytics_facts.sql", "utf8"));
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

const entry = (referrer: string, entrances: number) => ({
  grain: "entry" as const,
  key: JSON.stringify({ referrer, source: "", medium: "", visitor: "new" }),
  path: "/posts/a",
  articleId: "a",
  metrics: { entrances, engagedEntrances: entrances, entryPageViews: entrances },
});
describe("the long view", () => {
  /** Four weeks from Monday 2026-09-07: search halves in the last two, and one day is missing. */
  function collect(db: Awaited<ReturnType<typeof fixture>>["db"]) {
    db.exec(
      "CREATE TABLE articles(id TEXT PRIMARY KEY,status TEXT,published_at TEXT,published_revision_id TEXT);" +
        "CREATE TABLE article_revisions(id TEXT PRIMARY KEY,title TEXT);" +
        "CREATE TABLE routes(path TEXT,target_type TEXT,target_id TEXT,is_canonical INTEGER);" +
        "INSERT INTO articles VALUES('a','published','2026-09-20T16:00:00.000Z','r1');" +
        "INSERT INTO article_revisions VALUES('r1','上海のお茶');" +
        "INSERT INTO routes VALUES('/posts/a','article','a',1);",
    );
    const ga4: AnalyticsDay[] = [];
    const gsc: AnalyticsDay[] = [];
    for (let i = 0; i < 28; i++) {
      if (i === 10) continue;
      const date = new Date(Date.UTC(2026, 8, 7 + i)).toISOString().slice(0, 10);
      const base = { date, retrievedAt: "2026-10-20T00:00:00.000Z", provisional: false };
      const search = i < 14 ? 10 : 5;
      ga4.push({
        ...base,
        source: "ga4",
        rows: [
          { grain: "site", key: "", path: null, articleId: null, metrics: { pageViews: 40 } },
          {
            grain: "page",
            key: "/posts/a",
            path: "/posts/a",
            articleId: "a",
            metrics: { pageViews: 30 },
          },
          entry("www.google.com", search),
          entry("chatgpt.com", 2),
        ],
      });
      gsc.push({
        ...base,
        source: "gsc_url",
        rows: [
          {
            grain: "page",
            key: "/posts/a",
            path: "/posts/a",
            articleId: "a",
            metrics: { clicks: search, impressions: 100, positionSum: 300 },
          },
        ],
      });
    }
    const range = { start: "2026-09-07", end: "2026-10-04" };
    for (const [source, days] of [
      ["ga4", ga4],
      ["gsc_url", gsc],
    ] as const)
      for (const { sql, params } of analyticsReplacement(
        source,
        range,
        days,
        "2026-10-20T00:00:00.000Z",
      ))
        db.prepare(sql).run(...(params as never[]));
  }
  async function trend(input: Record<string, unknown>) {
    const { app, env, db } = await fixture();
    collect(db);
    const res = await app.request(
      "/v1/admin/ops/analytics.trend",
      {
        method: "POST",
        headers: { authorization: "Bearer test", "content-type": "application/json" },
        body: JSON.stringify({ start: "2026-09-07", end: "2026-10-04", ...input }),
      },
      env,
    );
    expect(res.status).toBe(200);
    return (await res.json()) as {
      buckets: { start: string; complete: boolean }[];
      coverage: { source: string; days: number[] }[];
      series: {
        key: string;
        title?: string;
        publishedAt?: string;
        values: Record<string, (number | null)[]>;
        compared?: { clicks: { earlier: number; recent: number } };
      }[];
      published?: number[];
      list: { total: number } | null;
    };
  }
  it("sums the site by week, shows the missing day as coverage and counts what was published", async () => {
    const result = await trend({});
    expect(result.buckets.map((b) => b.start)).toEqual([
      "2026-09-07",
      "2026-09-14",
      "2026-09-21",
      "2026-09-28",
    ]);
    expect(result.buckets.every((b) => b.complete)).toBe(true);
    expect(result.series[0]!.values["pageViews"]).toEqual([280, 240, 280, 280]);
    expect(result.series[0]!.values["entrances"]).toEqual([84, 72, 49, 49]);
    expect(result.series[0]!.values["clicks"]).toBeUndefined();
    expect(result.coverage.find((c) => c.source === "ga4")!.days).toEqual([7, 6, 7, 7]);
    // 2026-09-20T16:00Z is the 21st in Japan.
    expect(result.published).toEqual([0, 0, 1, 0]);
  });
  it("splits by channel, and by month when asked", async () => {
    const result = await trend({ by: "channel", bucket: "month" });
    expect(result.buckets.map((b) => [b.start, b.complete])).toEqual([
      ["2026-09-01", false],
      ["2026-10-01", false],
    ]);
    expect(result.series.map((line) => line.key)).toEqual(["organic_search", "ai_assistant"]);
    expect(result.series[1]!.values["entrances"]).toEqual([46, 8]);
  });
  it("names the articles that fell, with search position and click-through", async () => {
    const result = await trend({ by: "article", sort: "decline" });
    const line = result.series[0]!;
    expect(line).toMatchObject({ key: "a", title: "上海のお茶", path: "/posts/a" });
    expect(line.compared!.clicks).toEqual({ earlier: 130, recent: 70 });
    expect(line.values["clicks"]).toEqual([70, 60, 35, 35]);
    expect(line.values["position"]).toEqual([4, 4, 4, 4]);
    expect(line.values["ctr"]![0]).toBeCloseTo(0.1);
    expect(result.list).toEqual({ total: 1, offset: 0, returned: 1 });
  });
  it("refuses more than 800 days", async () => {
    const { app, env } = await fixture();
    const res = await app.request(
      "/v1/admin/ops/analytics.trend",
      {
        method: "POST",
        headers: { authorization: "Bearer test", "content-type": "application/json" },
        body: JSON.stringify({ start: "2024-01-01", end: "2026-10-04" }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });
});
