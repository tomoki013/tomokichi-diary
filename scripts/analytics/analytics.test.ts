import { describe, expect, it } from "vitest";
import { assertAnalyticsDay } from "@tomokichi/contracts";
import { dateRange } from "@tomokichi/application";
import { buildDays } from "./collect.js";
import { queryConfig } from "./bigquery.js";
import { adsenseUrl, parseAdSensePages } from "./adsense.js";
import type { Route } from "@tomokichi/domain";
const range = dateRange("2026-10-01", "2026-10-02");
const now = "2026-10-05T00:00:00Z";
describe("collection quality boundary", () => {
  it("rejects duplicate grain keys, nonfinite metrics, invalid days and oversized private data", () => {
    const day = buildDays("ga4", range, ["2026-10-01"], [], [], now)[0]!;
    expect(() => assertAnalyticsDay({ ...day, rows: [...day.rows, ...day.rows] })).toThrow(
      "DUPLICATE",
    );
    expect(() => assertAnalyticsDay({ ...day, date: "2026-02-30" })).toThrow();
    expect(() =>
      assertAnalyticsDay({ ...day, rows: [{ ...day.rows[0], metrics: { users: Infinity } }] }),
    ).toThrow();
    expect(() =>
      assertAnalyticsDay({
        ...day,
        rows: [{ ...day.rows[0], metrics: { users: 9007199254740992 } }],
      }),
    ).toThrow();
    expect(() =>
      assertAnalyticsDay({
        ...day,
        rows: [{ ...day.rows[0], metrics: { clicks: 5, impressions: 1 } }],
      }),
    ).toThrow();
    expect(() =>
      assertAnalyticsDay({
        ...day,
        rows: Array.from({ length: 1000 }, (_, i) => ({
          ...day.rows[0],
          key: `${i}`.padEnd(1000, "a"),
        })),
      }),
    ).toThrow("TOO_LARGE");
  });
  it("parameterizes dates/property; rejects malicious range before SQL; excludes intraday", () => {
    const config = queryConfig("ga4", range);
    expect(config.queryParameters).toContainEqual({
      name: "start",
      parameterType: { type: "STRING" },
      parameterValue: { value: range.start },
    });
    expect(config.query).toContain("_TABLE_SUFFIX BETWEEN");
    expect(config.query).toContain("r'^\\d{8}$'");
    expect(config.maximumBytesBilled).toBe("1000000000");
    expect(() => queryConfig("ga4", { start: "2026-10-01' OR TRUE--", end: range.end })).toThrow();
  });
});
const cells = (url: string, yen: string) => ({
  cells: ["2026-10-01", url, yen, "10", "5", "0", "12"].map((value) => ({ value })),
});
describe("AdSense page earnings", () => {
  const routes = [
    {
      id: "r1",
      path: "/posts/shanghai-chagee-menu",
      locale: "ja",
      targetType: "article",
      targetId: "a1",
      isCanonical: true,
      redirectTo: null,
      redirectStatus: null,
      isLegacy: false,
      noindex: false,
    },
  ] as unknown as Route[];
  const headers = [
    { name: "DATE" },
    { name: "PAGE_URL" },
    { name: "ESTIMATED_EARNINGS", currencyCode: "JPY" },
    { name: "IMPRESSIONS" },
    { name: "PAGE_VIEWS" },
    { name: "CLICKS" },
    { name: "AD_REQUESTS" },
  ];
  it("asks for the page dimension instead of the ad unit", () => {
    const url = new URL(adsenseUrl("accounts/pub-1", range, "pages"));
    expect(url.searchParams.getAll("dimensions")).toEqual(["DATE", "PAGE_URL"]);
  });
  it("folds query strings into one article row and keeps the site totals apart", () => {
    const days = parseAdSensePages(
      {
        headers,
        rows: [
          cells("https://tomokichidiary.com/posts/shanghai-chagee-menu", "12.5"),
          cells("https://tomokichidiary.com/posts/shanghai-chagee-menu?utm_source=x", "2.5"),
          cells("https://example.com/elsewhere", "9"),
        ],
        totalMatchedRows: "3",
      },
      range,
      routes,
      now,
    );
    expect(days).toHaveLength(1);
    const rows = days[0]!.rows.filter((row) => row.articleId === "a1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ grain: "page", path: "/posts/shanghai-chagee-menu" });
    expect(rows[0]!.metrics["estimatedEarningsJPY"]).toBe(15);
    expect(days[0]!.rows.some((row) => row.grain === "site")).toBe(false);
  });
});
