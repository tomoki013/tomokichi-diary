import { describe, expect, it } from "vitest";
import { articleReading } from "./articles.js";
import type { AnalyticsDay } from "./model.js";

const day = (source: AnalyticsDay["source"], date: string, rows: AnalyticsDay["rows"]) =>
  ({ source, date, retrievedAt: date, provisional: false, rows }) as unknown as AnalyticsDay;
const measure = (measurement: string, observations: number) => ({
  grain: "experience" as const,
  key: JSON.stringify({ layout: "article-end-v1", device: "mobile", measurement }),
  path: "/posts/a",
  articleId: "a",
  metrics: { observations },
});

describe("reading per article", () => {
  it("joins reach, next article, search in both periods and earnings", () => {
    const rows = articleReading(
      [
        day("ga4", "2026-10-10", [
          measure("article_view", 100),
          measure("body_75", 40),
          measure("next_article", 5),
          {
            grain: "page",
            key: "a",
            path: "/posts/a",
            articleId: "a",
            metrics: { pageViews: 120 },
          },
        ]),
        day("gsc_url", "2026-10-10", [
          {
            grain: "page",
            key: "a",
            path: "/posts/a",
            articleId: "a",
            metrics: { clicks: 30, impressions: 300, positionSum: 1200 },
          },
        ]),
        day("gsc_url", "2026-09-10", [
          {
            grain: "page",
            key: "a",
            path: "/posts/a",
            articleId: "a",
            metrics: { clicks: 50, impressions: 300, positionSum: 900 },
          },
        ]),
        day("adsense", "2026-10-10", [
          {
            grain: "page",
            key: "a",
            path: "/posts/a",
            articleId: "a",
            metrics: { estimatedEarningsJPY: 15 },
          },
        ]),
      ],
      { start: "2026-10-01", end: "2026-10-28" },
      { start: "2026-09-03", end: "2026-09-30" },
    );
    expect(rows).toEqual([
      expect.objectContaining({
        articleId: "a",
        pageViews: 120,
        measuredViews: 100,
        body75Rate: 0.4,
        nextArticleRate: 0.05,
        clicks: 30,
        clicksPrevious: 50,
        position: 5,
        positionPrevious: 4,
        earningsJPY: 15,
      }),
    ]);
  });
});
