import { describe, it, expect } from "vitest";
import type { Route } from "@tomokichi/domain";
import {
  addMetrics,
  comparison,
  dateRange,
  dates,
  normalizeAnalyticsUrl,
  previousRange,
  resolveAnalyticsArticle,
  shiftDate,
  type AnalyticsDay,
  type AnalyticsRow,
} from "../model.js";
import { analyticsDashboard } from "../dashboard.js";
const row = (
  metrics: Record<string, number | null>,
  overrides: Partial<AnalyticsRow> = {},
): AnalyticsRow => ({ grain: "site", key: "", path: null, articleId: null, metrics, ...overrides });
const route = (path: string, overrides: Partial<Route> = {}): Route =>
  ({
    id: path,
    path,
    locale: "ja",
    targetType: "article",
    targetId: "a",
    isCanonical: true,
    redirectTo: null,
    redirectStatus: null,
    isLegacy: false,
    noindex: false,
    ...overrides,
  }) as Route;
describe("analytics calendar", () => {
  it.each(["2026-02-29", "2026-13-01", "2026-01-32", "2026-1-01", "2026-01-01';DROP TABLE x--"])(
    "rejects invalid date %s",
    (date) => expect(() => dateRange(date, "2026-12-31")).toThrow(),
  );
  it("uses inclusive days and adjacent equal comparisons across year/leap boundaries", () => {
    expect(dates(dateRange("2024-02-28", "2024-03-01"))).toEqual([
      "2024-02-28",
      "2024-02-29",
      "2024-03-01",
    ]);
    expect(previousRange(dateRange("2026-01-01", "2026-01-07"))).toEqual({
      start: "2025-12-25",
      end: "2025-12-31",
    });
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(() => dateRange("2026-01-01", "2026-04-10")).toThrow();
    expect(() => dateRange("2026-01-10", "2026-01-01")).toThrow();
  });
});
describe("URLs and identity", () => {
  it.each([
    "https://evil.com/posts/a",
    "//evil.com/a",
    "javascript:alert(1)",
    "https://tomokichidiary.com.evil.com/a",
    "https://user@tomokichidiary.com/a",
    "https://tomokichidiary.com:8443/a",
  ])("rejects unrelated/unsafe URL %s", (url) => expect(normalizeAnalyticsUrl(url)).toBeNull());
  it("normalizes host, fragment, query and trailing slash without decoding path ambiguities", () => {
    expect(normalizeAnalyticsUrl("https://www.tomokichidiary.com/posts/a/?utm=a#b")).toBe(
      "/posts/a",
    );
    expect(normalizeAnalyticsUrl("/posts/a%2Fb")).toBe("/posts/a%2Fb");
    expect(normalizeAnalyticsUrl("https://tomokichidiary.com")).toBe("/");
  });
  it("maps redirect and alternate route to article id and canonical without guessing slug", () => {
    const routes = [
      route("/old", {
        targetType: "redirect",
        targetId: null,
        redirectTo: "/alternate" as Route["path"],
      }),
      route("/alternate", { isCanonical: false }),
      route("/canonical"),
    ];
    expect(resolveAnalyticsArticle("https://tomokichidiary.com/old?x=1", routes)).toEqual({
      articleId: "a",
      path: "/canonical",
    });
    expect(resolveAnalyticsArticle("/unknown", routes)).toEqual({
      articleId: null,
      path: "/unknown",
    });
    expect(
      resolveAnalyticsArticle("/old", [
        route("/old", { targetType: "redirect", redirectTo: "/old" as Route["path"] }),
      ]).articleId,
    ).toBeNull();
  });
});
describe("metric projections", () => {
  it("weights position and CTR using unrounded numerators, never sums uniques", () => {
    const metrics = addMetrics([
      row({ impressions: 10, clicks: 1, positionSum: 0, users: 10, sessions: 8 }),
      row({ impressions: 90, clicks: 9, positionSum: 900, users: 20, sessions: 12 }),
    ]);
    expect(metrics).toMatchObject({ impressions: 100, clicks: 10, ctr: 0.1, position: 10 });
    expect(metrics["users"]).toBeUndefined();
    expect(metrics["sessions"]).toBeUndefined();
    expect(addMetrics([row({ impressions: 0, clicks: 0, positionSum: 0 })])["position"]).toBeNull();
    expect(comparison(5, 0)).toBeNull();
    expect(comparison(5, 10)).toBe(-0.5);
  });
  it("keeps site and URL grains separate, preserves missing vs zero and period daily means", async () => {
    const days: AnalyticsDay[] = [
      {
        source: "ga4",
        date: "2026-10-02",
        retrievedAt: "2026-10-05T00:00:00Z",
        provisional: true,
        rows: [
          row({ pageViews: 0, users: 5, sessions: 2 }),
          row({ pageViews: 999 }, { grain: "page", key: "/a", path: "/a", articleId: "a" }),
        ],
      },
      {
        source: "gsc_url",
        date: "2026-10-02",
        retrievedAt: "2026-10-05T00:00:00Z",
        provisional: true,
        rows: [
          row(
            { clicks: 999, impressions: 1000 },
            { grain: "page", key: "/a", path: "/a", articleId: "a" },
          ),
        ],
      },
      {
        source: "gsc_site",
        date: "2026-10-02",
        retrievedAt: "2026-10-05T00:00:00Z",
        provisional: true,
        rows: [row({ clicks: 10, impressions: 100, positionSum: 200 })],
      },
    ];
    const dashboard = await analyticsDashboard(
      { read: async () => days, statuses: async () => [] },
      dateRange("2026-10-01", "2026-10-02"),
    );
    expect(dashboard.current.find((s) => s.source === "ga4")).toMatchObject({
      coveredDays: 1,
      expectedDays: 2,
      metrics: { pageViews: 0, meanDailyUsers: 5 },
    });
    expect(dashboard.current.find((s) => s.source === "gsc_site")?.metrics["clicks"]).toBe(10);
    expect(dashboard.daily[0]?.sources.find((s) => s.source === "ga4")?.metrics).toBeNull();
    expect(
      dashboard.daily[1]?.sources.find((s) => s.source === "ga4")?.metrics?.["pageViews"],
    ).toBe(0);
    expect(dashboard.current.find((s) => s.source === "adsense")?.metrics).toEqual({});
    const article = await analyticsDashboard(
      { read: async () => days, statuses: async () => [] },
      dateRange("2026-10-01", "2026-10-02"),
      "a",
    );
    expect(article.current.find((s) => s.source === "gsc_url")?.metrics["clicks"]).toBe(999);
    expect(
      article.current.find((s) => s.source === "ga4")?.metrics["meanDailyUsers"],
    ).toBeUndefined();
  });
});
