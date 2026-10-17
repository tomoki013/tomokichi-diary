import { it, expect } from "vitest";
import { experienceSummary } from "../experience.js";
import { analyticsDashboard } from "../dashboard.js";
import type { AnalyticsDay } from "../model.js";
const row = (variant: string, measurement: string, observations: number) => ({
  grain: "experience" as const,
  key: JSON.stringify({
    layout: "article-placement-v2",
    device: "mobile",
    measurement,
    placement: "none",
    vital: "none",
    experimentId: "chagee-placement-v1",
    variant,
  }),
  path: "/posts/shanghai-chagee-menu",
  articleId: "target",
  metrics: { observations, valueSum: observations },
});
const days: AnalyticsDay[] = [
  {
    source: "ga4",
    date: "2026-10-15",
    retrievedAt: "2026-10-16T00:00:00.000Z",
    provisional: true,
    rows: [
      row("A", "article_view", 100),
      row("B", "article_view", 120),
      row("A", "body_end", 40),
      row("B", "body_end", 60),
      row("A", "experiment_assignment", 100),
      row("B", "experiment_assignment", 120),
    ],
  },
];
it("separates A/B and historical layouts and does not declare a winner on short samples", () => {
  const range = { start: "2026-10-01", end: "2026-10-15" };
  expect(experienceSummary(days, range)).toEqual([]);
  const result = experienceSummary(days, range, "target", true);
  expect(result).toHaveLength(2);
  expect(result.find((c) => c.variant === "B")).toMatchObject({
    views: 120,
    assignments: 120,
    bodyEndRate: 0.5,
    reviewReady: false,
    measuredDays: 1,
  });
  expect(experienceSummary(days, range, "other", true)).toEqual([]);
});
it("preserves missing revenue and never double adds ad units to site revenue", async () => {
  const dashboard = await analyticsDashboard(
    {
      read: async () => [
        ...days,
        {
          source: "adsense",
          date: "2026-10-15",
          retrievedAt: "2026-10-16T00:00:00.000Z",
          provisional: true,
          rows: [
            {
              grain: "site",
              key: "",
              path: null,
              articleId: null,
              metrics: { estimatedEarningsJPY: 10, adPageViews: 100 },
            },
            {
              grain: "ad_unit",
              key: "7152502134",
              path: null,
              articleId: null,
              metrics: { estimatedEarningsJPY: 10, adPageViews: 1 },
            },
          ],
        },
      ],
      statuses: async () => [],
    },
    { start: "2026-10-01", end: "2026-10-15" },
  );
  expect(
    dashboard.current.find((s) => s.source === "adsense")?.metrics["estimatedEarningsJPY"],
  ).toBe(10);
  expect(dashboard.experiments.current).toHaveLength(2);
  expect(dashboard.experiments.current[0]).not.toHaveProperty("estimatedEarningsJPY");
});
