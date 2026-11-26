import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { createTestContext } from "@tomokichi/infra-d1/testing-context";
import { openInMemoryDatabase } from "@tomokichi/infra-d1/testing";
import { analyticsReplacement, createAnalyticsStore, fromD1 } from "@tomokichi/infra-d1";
import { analyticsView, type AnalyticsDay } from "@tomokichi/application";
import { createApp } from "../app.js";
import type { Env } from "../env.js";
async function fixture() {
  const db = openInMemoryDatabase();
  db.exec(readFileSync("migrations/0015_analytics.sql", "utf8"));
  db.exec(readFileSync("migrations/0016_analytics_period_counts.sql", "utf8"));
  db.exec(readFileSync("migrations/0031_analytics_facts.sql", "utf8"));
  // What the view reads to name articles and tell affiliate clicks apart.
  db.exec(readFileSync("migrations/0001_initial.sql", "utf8"));
  db.exec("CREATE TABLE publication_metadata(revision_id TEXT PRIMARY KEY,metadata TEXT)");
  db.exec(
    "CREATE TABLE affiliate_offers(id TEXT PRIMARY KEY,status TEXT,payload TEXT,updated_at TEXT)",
  );
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
it("keeps URL × query ties distinct in D1 and matches only the shown prior row", async () => {
  const { db, env } = await fixture();
  for (const [date, names] of [
    ["2026-11-15", ["b", "c"]],
    ["2026-11-16", ["b", "a"]],
  ] as const) {
    const rows = names.map((id) => ({
      articleId: id,
      path: "/posts/" + id,
      grain: "query",
      key: "同じ語",
      metrics: { clicks: 3, impressions: 30, positionSum: 60 },
    }));
    db.prepare("INSERT INTO analytics_days(source,date,payload) VALUES (?,?,?)").run(
      "gsc_url",
      date,
      JSON.stringify({ source: "gsc_url", date, rows, retrievedAt: date, provisional: false }),
    );
  }
  const read = async (offset: number, articleId?: string) =>
    (
      await analyticsView(
        createAnalyticsStore(fromD1(env.DB)),
        { start: "2026-11-16", end: "2026-11-16" },
        articleId,
        { limit: 1, offset },
      )
    ).queries;
  const first = await read(0),
    second = await read(1);
  expect(first.rows[0]).toMatchObject({ articleId: "a", clicksPrevious: null });
  expect(second.rows[0]).toMatchObject({ articleId: "b", clicks: 3, clicksPrevious: 3 });
  const end = await read(2);
  expect([end.total, end.offset, end.returned]).toEqual([2, 2, 0]);
  expect((await read(0, "b")).total).toBe(1);
});

it("names and classifies articles from the published version, and counts clicks to offers", async () => {
  const { app, db, env } = await fixture();
  db.exec(`INSERT INTO authors(id,name) VALUES('owner','筆者');
   INSERT INTO articles(id,status,locale,slug,author_id,published_revision_id,created_at,updated_at) VALUES('a','published','ja','tea','owner','published','2026-01-01','2026-01-01');
   INSERT INTO article_revisions(id,article_id,revision_number,title,summary,body_markdown,created_at,created_by) VALUES('draft','a',1,'非公開版','','','2026-01-01','owner'),('published','a',2,'旅行記','要約','','2026-01-02','owner');
   INSERT INTO routes(id,path,locale,target_type,target_id,is_canonical) VALUES('r','/posts/tea','ja','article','a',1);
   INSERT INTO tags VALUES('tag','tea','チャジー');
   INSERT INTO publication_metadata VALUES('published','{"tags":[{"tagId":"tag"}]}');`);
  db.prepare("INSERT INTO affiliate_offers VALUES(?,?,?,?)").run(
    "o",
    "ready",
    JSON.stringify({ provider: "Trip.com", url: "https://www.trip.com/t/secret-id" }),
    "2026-11-16",
  );
  const date = "2026-11-16";
  db.prepare("INSERT INTO analytics_days(source,date,payload) VALUES (?,?,?)").run(
    "ga4",
    date,
    JSON.stringify({
      source: "ga4",
      date,
      retrievedAt: date,
      provisional: false,
      rows: [
        {
          grain: "site",
          key: "",
          articleId: null,
          path: null,
          metrics: { pageViews: 10, outboundClicks: 1 },
        },
        {
          grain: "page",
          key: "tea",
          articleId: "a",
          path: "/posts/tea",
          metrics: { pageViews: 3 },
        },
        {
          grain: "outbound",
          key: "www.trip.com",
          articleId: "a",
          path: "/posts/tea",
          metrics: { eventCount: 1 },
        },
      ],
    }),
  );
  const res = await app.request(
    "/v1/admin/ops/analytics.dashboard",
    {
      method: "POST",
      headers: { "cf-access-jwt-assertion": "valid", "content-type": "application/json" },
      body: JSON.stringify({ start: date, end: date }),
    },
    env,
  );
  const { dashboard } = await res.json();
  // The tag names the brand though the published title does not; the draft title never shows.
  expect(dashboard.articles.rows[0]).toMatchObject({
    title: "旅行記",
    path: "/posts/tea",
    theme: "chagee",
    affiliateClicks: 1,
  });
  expect(dashboard.themes[0]).toMatchObject({ theme: "chagee", pageViews: 3, share: 0.3 });
  expect(dashboard.totals.current.affiliateClicks).toBe(1);
  expect(JSON.stringify(dashboard)).not.toContain("secret-id");
});
afterEach(() => vi.unstubAllGlobals());
describe("private analytics HTTP boundary", () => {
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
      result.dashboard.sources.every((s: { coveredDays: number }) => s.coveredDays === 0),
    ).toBe(true);
    expect(result.dashboard.totals.current.pageViews).toBeNull();
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

  it("always answers in the same shape, pages the lists, and marks no data as null", async () => {
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
    expect(Object.keys(full).toSorted()).toEqual(
      [
        "anchorTest",
        "articles",
        "breakdowns",
        "daily",
        "notes",
        "previousRange",
        "queries",
        "range",
        "scope",
        "sources",
        "themes",
        "totals",
      ].toSorted(),
    );
    expect(full.queries).toMatchObject({ total: 30, offset: 0, returned: 20 });
    expect(full.scope).toBe("site");
    expect(full.totals.current.adsenseJPY).toBeNull();
    expect(full.totals.current.pageViews).toBe(700);
    expect(full.totals.current.searchClicks).toBeNull();

    // Old callers that still send sections get the same answer.
    const next = (await op("analytics.dashboard", { ...week, sections: ["queries"], offset: 20 }))
      .body.dashboard;
    expect(next.queries.rows.map((q: any) => q.query)).toEqual(
      Array.from({ length: 10 }, (_, i) => `query ${20 + i}`),
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

    const report = (await op("analytics.report", { period: "weekly", start: "2026-10-05" })).body;
    expect(report.range).toEqual(week);
    expect(report.snapshot).toEqual({ state: "saved", generatedAt: "2026-10-12T07:00:00.000Z" });
    expect(report.dashboard.totals).toEqual(full.totals);
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
    db.exec(`INSERT INTO authors(id,name) VALUES('owner','筆者');
      INSERT INTO articles(id,status,locale,slug,author_id,published_revision_id,published_at,created_at,updated_at)
        VALUES('a','published','ja','a','owner','r1','2026-09-20T16:00:00.000Z','2026-09-01','2026-09-01');
      INSERT INTO article_revisions(id,article_id,revision_number,title,summary,body_markdown,created_at,created_by)
        VALUES('r1','a',1,'上海のお茶','','','2026-09-01','owner');
      INSERT INTO routes(id,path,locale,target_type,target_id,is_canonical) VALUES('r','/posts/a','ja','article','a',1);`);
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

describe("reading only what a request needs", () => {
  async function stores() {
    const { env, db } = await fixture();
    seed(db);
    db.prepare("INSERT INTO analytics_days(source,date,payload) VALUES (?,?,?)").run(
      "gsc_site",
      "2026-10-05",
      JSON.stringify({
        source: "gsc_site",
        date: "2026-10-05",
        retrievedAt: "2026-10-20T00:00:00.000Z",
        provisional: true,
        rows: [
          {
            grain: "site",
            key: "",
            path: null,
            articleId: null,
            metrics: { clicks: 4, impressions: 40, positionSum: 80 },
          },
          {
            grain: "country",
            key: "jpn",
            path: null,
            articleId: null,
            metrics: { clicks: 4, impressions: 40, positionSum: 80 },
          },
        ],
      }),
    );
    const narrowed = createAnalyticsStore(fromD1(env.DB as never));
    // The same store, made to read whole days as it did before.
    const whole = {
      ...narrowed,
      read: (range: { start: string; end: string }) => narrowed.read(range),
    };
    return { narrowed, whole };
  }
  const week = { start: "2026-10-05", end: "2026-10-11" };

  it("gives a day only the rows of the grains asked for, and still gives the day", async () => {
    const { narrowed } = await stores();
    const days = await narrowed.read(week, ["site"]);
    expect(days).toHaveLength(15);
    const search = days.find((day) => day.source === "gsc_site")!;
    expect(search).toMatchObject({ date: "2026-10-05", provisional: true });
    expect(search.rows.map((row) => row.grain)).toEqual(["site"]);
    expect(search.rows[0]!.metrics).toEqual({ clicks: 4, impressions: 40, positionSum: 80 });
    const queries = days.filter((day) => day.source === "gsc_url");
    expect(queries).toHaveLength(7);
    expect(queries.every((day) => day.rows.length === 0 && day.provisional === false)).toBe(true);
  });

  it("answers exactly as a read of whole days does", async () => {
    const { narrowed, whole } = await stores();
    for (const articleId of [undefined, "a"])
      expect(await analyticsView(narrowed, week, articleId)).toEqual(
        await analyticsView(whole, week, articleId),
      );
  });
});
