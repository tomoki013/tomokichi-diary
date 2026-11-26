import { describe, expect, it } from "vitest";
import { ANCHOR_AD_EXPERIMENT } from "@tomokichi/contracts";
import { analyticsView } from "./view.js";
import { queryIntent } from "./classify.js";
import type { AnalyticsDay, AnalyticsRow } from "./model.js";

const day = "2026-11-24";
function observedRow(
  articleId: string,
  device: string,
  variant: string,
  measurement: string,
  count: number,
  ms?: number,
): AnalyticsRow {
  return {
    grain: "experience",
    articleId,
    path: "/posts/" + articleId,
    key: JSON.stringify({
      layout: "article-placement-v2",
      experimentId: ANCHOR_AD_EXPERIMENT,
      device,
      variant,
      measurement,
    }),
    metrics: { observations: count, ...(ms === undefined ? {} : { valueSum: ms }) },
  };
}

describe("anchor test comparison", () => {
  it("pools the underlying observations across articles and devices independently of list pagination", async () => {
    const data: AnalyticsDay = {
      date: day,
      source: "ga4",
      provisional: true,
      retrievedAt: day,
      rows: [
        observedRow("one", "mobile", "A", "article_view", 10),
        observedRow("one", "mobile", "A", "body_end", 10),
        observedRow("one", "mobile", "A", "visible_time", 2, 15000),
        observedRow("two", "desktop", "A", "article_view", 90),
        observedRow("two", "desktop", "A", "visible_time", 50, 150000),
        observedRow("two", "mobile", "B", "article_view", 2),
        observedRow("two", "mobile", "B", "body_end", 1),
        observedRow("old", "mobile", "none", "article_view", 500),
        {
          ...observedRow("old", "mobile", "A", "article_view", 500),
          key: JSON.stringify({
            layout: "article-placement-v2",
            device: "mobile",
            experimentId: "chagee-placement-v1",
            variant: "A",
            measurement: "article_view",
          }),
        },
      ],
    };
    const result = await analyticsView(
      { read: async () => [data], statuses: async () => [] },
      { start: day, end: day },
      undefined,
      { limit: 1, offset: 12 },
    );
    expect(result.anchorTest).toHaveLength(5);
    expect(result.anchorTest.find((c) => c.variant === "A" && c.device === "all")).toMatchObject({
      views: 100,
      bodyEndRate: 0.1,
      visibleMsPerView: 1650,
      measuredDays: 1,
    });
    expect(result.anchorTest.find((c) => c.variant === "B" && c.device === "mobile")).toMatchObject(
      { views: 2, bodyEndRate: 0.5, visibleMsPerView: null },
    );
    expect(
      result.anchorTest.find((c) => c.variant === "A" && c.device === "mobile")?.bodyEndRate,
    ).toBe(1);
  });
});

const page = (id: string, pv: number): AnalyticsRow => ({
  grain: "page",
  key: "/posts/" + id,
  path: "/posts/" + id,
  articleId: id,
  metrics: { pageViews: pv },
});
const of = (source: AnalyticsDay["source"], date: string, rows: AnalyticsRow[]): AnalyticsDay => ({
  source,
  date,
  retrievedAt: "2026-11-27T00:00:00Z",
  provisional: false,
  rows,
});
const labels = async () =>
  new Map([
    ["tea", { title: "CHAGEEのおすすめ", path: "/posts/tea", publishedAt: null, tags: [] }],
    ["air", { title: "チャンギ空港の水", path: "/posts/air", publishedAt: null, tags: [] }],
  ]);

describe("the analytics view", () => {
  const week = { start: "2026-11-16", end: "2026-11-22" };
  const next = observedRow("tea", "mobile", "A", "next_article", 2);
  next.key = JSON.stringify({ ...JSON.parse(next.key), placement: "nav_body" });
  const days = [
    of("ga4", "2026-11-09", [
      { grain: "site", key: "", path: null, articleId: null, metrics: { pageViews: 50 } },
      page("tea", 30),
    ]),
    of("ga4", "2026-11-16", [
      {
        grain: "site",
        key: "",
        path: null,
        articleId: null,
        metrics: { pageViews: 100, outboundClicks: 2 },
      },
      page("tea", 60),
      page("air", 30),
      observedRow("tea", "mobile", "A", "article_view", 40),
      observedRow("tea", "mobile", "A", "body_end", 10),
      next,
      {
        grain: "outbound",
        key: "www.trip.com",
        path: "/posts/air",
        articleId: "air",
        metrics: { eventCount: 2 },
      },
      {
        grain: "outbound",
        key: "map.baidu.com",
        path: "/posts/tea",
        articleId: "tea",
        metrics: { eventCount: 9 },
      },
    ]),
    of("adsense", "2026-11-16", [
      {
        grain: "site",
        key: "JPY",
        path: null,
        articleId: null,
        metrics: { estimatedEarningsJPY: 10 },
      },
      { ...page("tea", 0), metrics: { estimatedEarningsJPY: 6 } },
    ]),
  ];
  const store = { read: async () => days, statuses: async () => [] };
  const view = () =>
    analyticsView(store, week, undefined, {
      labels,
      affiliateHosts: async () => [{ host: "www.trip.com", provider: "Trip.com" }],
    });

  it("gives every article one row with reading, search, earnings and affiliate clicks", async () => {
    const { articles } = await view();
    expect(articles.total).toBe(2);
    expect(articles.rows[0]).toMatchObject({
      articleId: "tea",
      theme: "chagee",
      pageViews: 60,
      pageViewsPrevious: 30,
      measuredViews: 40,
      bodyEndRate: 0.25,
      nextArticleRate: 0.05,
      nextArticleAreas: { nav_body: 2 },
      adsenseJPY: 6,
      // Baidu Maps is not an offer: no affiliate click, but collected, so zero.
      affiliateClicks: 0,
    });
    expect(articles.rows[1]).toMatchObject({
      articleId: "air",
      affiliateClicks: 2,
      adsenseJPY: null,
    });
  });
  it("splits site page views into CHAGEE, non-CHAGEE and the rest without double counting", async () => {
    const { themes, totals } = await view();
    expect(themes.map((t) => [t.theme, t.pageViews, t.share])).toEqual([
      ["chagee", 60, 0.6],
      ["non_chagee", 30, 0.3],
      ["unknown", 10, 0.1],
    ]);
    expect(themes[0]).toMatchObject({ pageViewsPrevious: 30, sharePrevious: 0.6 });
    expect(totals.current).toMatchObject({
      pageViews: 100,
      adsenseJPY: 10,
      adsensePagesJPY: 6,
      affiliateClicks: 2,
      // Never collected: null, not 0.
      searchClicks: null,
      affiliateRewardJPY: null,
      users: null,
    });
    expect(totals.previous.affiliateClicks).toBeNull();
  });
  it("narrows to one article", async () => {
    const one = await analyticsView(store, week, "air", { labels });
    expect(one.scope).toBe("article");
    expect(one.articles.rows.map((r) => r.articleId)).toEqual(["air"]);
    expect(one.themes).toEqual([]);
    expect(one.totals.current.pageViews).toBe(30);
  });
});

describe("search intent", () => {
  it("keeps the bare brand, the brand with a need, travel searches and the rest apart", () => {
    expect(queryIntent("chagee")).toBe("brand");
    expect(queryIntent("霸王茶姬")).toBe("brand");
    expect(queryIntent("CHAGEE メニュー")).toBe("chagee_specific");
    expect(queryIntent("チャンギ空港 水")).toBe("non_chagee");
    expect(queryIntent("おすすめ")).toBe("unknown");
    expect(queryIntent("chage")).toBe("unknown");
  });
});
