import { describe, expect, it } from "vitest";
import { ANCHOR_AD_EXPERIMENT } from "@tomokichi/contracts";
import { analyticsDashboard } from "./dashboard.js";
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
    const result = await analyticsDashboard(
      { read: async () => [data], statuses: async () => [] },
      { start: day, end: day },
      undefined,
      { sections: ["anchorTest"], limit: 1, offset: 12 },
    );
    expect(result.anchorTest).toHaveLength(5);
    expect(result.anchorTest?.find((c) => c.variant === "A" && c.device === "all")).toMatchObject({
      views: 100,
      bodyEndRate: 0.1,
      visibleMsPerView: 1650,
      measuredDays: 1,
    });
    expect(
      result.anchorTest?.find((c) => c.variant === "B" && c.device === "mobile"),
    ).toMatchObject({ views: 2, bodyEndRate: 0.5, visibleMsPerView: null });
    expect(
      result.anchorTest?.find((c) => c.variant === "A" && c.device === "mobile")?.bodyEndRate,
    ).toBe(1);
  });
});
