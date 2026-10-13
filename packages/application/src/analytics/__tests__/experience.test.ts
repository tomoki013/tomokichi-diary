import { it, expect } from "vitest";
import { experienceSummary } from "../experience.js";
import type { AnalyticsDay, AnalyticsRow } from "../model.js";
const range = { start: "2026-10-01", end: "2026-10-02" };
const row = (
  measurement: string,
  n: number,
  overrides: Record<string, unknown> = {},
  metrics = {},
): AnalyticsRow => ({
  grain: "experience",
  key: JSON.stringify({
    layout: "article-end-v1",
    device: "mobile",
    measurement,
    placement: "none",
    vital: "none",
    ...overrides,
  }),
  path: "/posts/a",
  articleId: "a",
  metrics: { observations: n, valueSum: n, ...metrics },
});
const day = (date: string, rows: AnalyticsRow[]): AnalyticsDay => ({
  source: "ga4",
  date,
  retrievedAt: "2026-10-04T00:00:00Z",
  provisional: true,
  rows,
});
it("keeps missing telemetry empty and separates device, article and layout cohorts", () => {
  expect(experienceSummary([day(range.start, [])], range)).toEqual([]);
  const data = [
    day(range.start, [
      row("article_view", 10),
      row("body_end", 4),
      row("candidate_reach", 8, { placement: "candidate_mid_35" }),
      row("article_view", 100, { device: "desktop" }),
      row("article_view", 1000, { layout: "unknown" }),
    ]),
  ];
  const c = experienceSummary(data, range, "a").find((cohort) => cohort.device === "mobile")!;
  expect(c.views).toBe(10);
  expect(c.bodyEndRate).toBe(0.4);
  expect(c.candidate35Rate).toBe(0.8);
  expect(c.reviewReady).toBe(false);
  expect(experienceSummary(data, range, "other")).toEqual([]);
});
it("recomputes period ratios and p75 bands from counts instead of averaging daily ratios or percentiles", () => {
  const data = [
    day(range.start, [
      row("article_view", 10),
      row("ad_request", 10),
      row("ad_filled", 10),
      row(
        "web_vital",
        10,
        { vital: "LCP" },
        { vitalGood: 10, vitalNeedsImprovement: 0, vitalPoor: 0 },
      ),
    ]),
    day(range.end, [
      row("article_view", 90),
      row("ad_request", 90),
      row("ad_filled", 0),
      row(
        "web_vital",
        90,
        { vital: "LCP" },
        { vitalGood: 0, vitalNeedsImprovement: 30, vitalPoor: 60 },
      ),
    ]),
  ];
  const c = experienceSummary(data, range)[0]!;
  expect(c.adFillRate).toBe(0.1);
  expect(c.vitals.find((v) => v.vital === "LCP")).toMatchObject({
    samples: 100,
    p75Band: "poor",
    good: 10,
  });
  expect(c.vitals.find((v) => v.vital === "INP")).toMatchObject({
    samples: 0,
    p75Band: "insufficient",
  });
});
