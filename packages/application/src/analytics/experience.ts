import { ANCHOR_AD_EXPERIMENT, type AnchorTestCohort } from "@tomokichi/contracts";
import {
  addMetrics,
  ratio,
  type AnalyticsDay,
  type AnalyticsRow,
  type DateRange,
} from "./model.js";
/** What a reader measurement row's key carries. */
export interface ExperienceKey {
  readonly layout?: string;
  readonly device?: string;
  readonly experimentId?: string;
  readonly variant?: string;
  readonly measurement?: string;
  readonly placement?: string;
  readonly vital?: string;
}

// Rows are read once per request but summarised many times over; parsing each
// key once keeps the dashboard inside the Worker's CPU budget.
const parsedKeys = new WeakMap<AnalyticsRow, ExperienceKey | null>();

/** The parsed key of an experience row, or null when it is not valid JSON. */
export function experienceKey(row: AnalyticsRow): ExperienceKey | null {
  let parsed = parsedKeys.get(row);
  if (parsed === undefined) {
    try {
      const value: unknown = JSON.parse(row.key);
      parsed = value && typeof value === "object" ? (value as ExperienceKey) : null;
    } catch {
      parsed = null;
    }
    parsedKeys.set(row, parsed);
  }
  return parsed;
}

const bucketOf = (measurement?: string, placement?: string, vital?: string) =>
  `${measurement ?? ""}\u0000${placement ?? ""}\u0000${vital ?? ""}`;

/** The site-wide anchor ad test, per device and for all devices together. */
function anchorCohorts(days: readonly AnalyticsDay[], range: DateRange, articleId?: string) {
  const cohorts = new Map<
    string,
    {
      layout: string;
      device: string;
      experimentId: string;
      variant: string;
      rows: Map<string, AnalyticsRow[]>;
      dates: Set<string>;
    }
  >();
  for (const day of days) {
    if (day.source !== "ga4" || day.date < range.start || day.date > range.end) continue;
    for (const row of day.rows) {
      if (row.grain !== "experience" || (articleId && row.articleId !== articleId)) continue;
      const parsed = experienceKey(row);
      if (!parsed) continue;
      const dimensions = parsed as {
        layout: string;
        device: string;
        experimentId: string;
        variant: string;
      };
      const { layout, device } = dimensions;
      if (!["mobile", "desktop", "tablet"].includes(device)) continue;
      if (
        layout !== "article-placement-v2" ||
        !row.articleId ||
        !["A", "B"].includes(dimensions.variant) ||
        dimensions.experimentId !== ANCHOR_AD_EXPERIMENT
      )
        continue;
      for (const segment of [device, "all"]) {
        const key = JSON.stringify([layout, segment, dimensions.experimentId, dimensions.variant]);
        const cohort = cohorts.get(key) ?? {
          layout,
          device: segment,
          experimentId: dimensions.experimentId,
          variant: dimensions.variant,
          rows: new Map<string, AnalyticsRow[]>(),
          dates: new Set<string>(),
        };
        // Filed under every (measurement, placement, vital) filter a summary asks for.
        for (const bucket of new Set([
          bucketOf(parsed.measurement),
          bucketOf(parsed.measurement, parsed.placement),
          bucketOf(parsed.measurement, undefined, parsed.vital),
        ])) {
          const list = cohort.rows.get(bucket);
          if (list) list.push(row);
          else cohort.rows.set(bucket, [row]);
        }
        if (parsed.measurement === "article_view") cohort.dates.add(day.date);
        cohorts.set(key, cohort);
      }
    }
  }
  return [...cohorts.values()]
    .map((cohort) => {
      const sum = (measurement: string, placement?: string, vital?: string) =>
        addMetrics(cohort.rows.get(bucketOf(measurement, placement, vital)) ?? []);
      const count = (m: string, p?: string) => sum(m, p)["observations"] ?? 0;
      const visibleMs = sum("visible_time")["valueSum"];
      const views = count("article_view");
      const areas = Object.fromEntries(
        ["nav_next", "nav_related", "nav_series", "nav_adjacent", "nav_body", "none"].map(
          (area) => [area, count("next_article", area)],
        ),
      );
      const unknown =
        count("next_article") - Object.values(areas).reduce((total, n) => total + n, 0);
      if (unknown > 0) areas["unknown"] = unknown;
      const requests = count("ad_request"),
        filled = count("ad_filled");
      return {
        layout: cohort.layout,
        experimentId: cohort.experimentId,
        variant: cohort.variant,
        assignments: count("experiment_assignment"),
        body25Rate: ratio(count("body_25"), views),
        body50Rate: ratio(count("body_50"), views),
        body75Rate: ratio(count("body_75"), views),
        body90Rate: ratio(count("body_90"), views),
        device: cohort.device,
        measuredDays: cohort.dates.size,
        firstDate: [...cohort.dates].toSorted()[0] ?? "",
        lastDate: [...cohort.dates].toSorted().at(-1) ?? "",
        views,
        reviewReady: views >= 200 && cohort.dates.size >= 14,
        bodyEndRate: ratio(count("body_end"), views),
        candidate35Rate: ratio(count("candidate_reach", "candidate_mid_35"), views),
        candidate65Rate: ratio(count("candidate_reach", "candidate_mid_65"), views),
        adEligible: count("ad_eligible"),
        adRequests: requests,
        adFilled: filled,
        adUnfilled: count("ad_unfilled"),
        adScriptErrors: count("ad_script_error"),
        adViewableProxy: count("ad_viewable_proxy"),
        adRequestRate: ratio(requests, views),
        adFillRate: ratio(filled, requests),
        adViewableProxyRate: ratio(count("ad_viewable_proxy"), filled),
        visibleMsPerView: visibleMs == null ? null : ratio(visibleMs, views),
        nextArticleCount: count("next_article"),
        body75Count: count("body_75"),
        bodyEndCount: count("body_end"),
        nextArticleRate: ratio(count("next_article"), views),
        // Which link took the reader on; "none" is from before areas were recorded.
        nextArticleAreas: areas,
        shareActionRate: ratio(count("share_action"), views),
        likeActionRate: ratio(count("like_action"), views),
        vitals: ["LCP", "INP", "CLS"].map((vital) => {
          const metrics = sum("web_vital", undefined, vital);
          const n = metrics["observations"] ?? 0,
            good = metrics["vitalGood"] ?? 0,
            needs = metrics["vitalNeedsImprovement"] ?? 0;
          return {
            vital,
            samples: n,
            good,
            needsImprovement: needs,
            poor: metrics["vitalPoor"] ?? 0,
            p75Band:
              n < 50
                ? "insufficient"
                : good / n >= 0.75
                  ? "good"
                  : (good + needs) / n >= 0.75
                    ? "needs-improvement"
                    : "poor",
          };
        }),
      };
    })
    .toSorted((a, b) => (a.device + a.variant).localeCompare(b.device + b.variant, "en"));
}

/** An all-articles experiment is one randomized comparison. Pool the underlying
 * counts and durations before dividing, including across devices in the total. */
export function anchorTestSummary(
  days: readonly AnalyticsDay[],
  range: DateRange,
  articleId?: string,
): AnchorTestCohort[] {
  return anchorCohorts(days, range, articleId).map((row) => ({
    experimentId: ANCHOR_AD_EXPERIMENT,
    layout: row.layout,
    variant: row.variant as AnchorTestCohort["variant"],
    device: row.device as AnchorTestCohort["device"],
    assignments: row.assignments,
    views: row.views,
    measuredDays: row.measuredDays,
    body25Rate: row.body25Rate,
    body50Rate: row.body50Rate,
    body75Rate: row.body75Rate,
    body90Rate: row.body90Rate,
    bodyEndRate: row.bodyEndRate,
    visibleMsPerView: row.visibleMsPerView,
    nextArticleRate: row.nextArticleRate,
    adEligible: row.adEligible,
    adRequests: row.adRequests,
    adFilled: row.adFilled,
    adUnfilled: row.adUnfilled,
    adScriptErrors: row.adScriptErrors,
    adRequestRate: row.adRequestRate,
    adFillRate: row.adFillRate,
    adViewableProxy: row.adViewableProxy,
    adViewableProxyRate: row.adViewableProxyRate,
    vitals: row.vitals,
    adMeasurementScope: "article_slots" as const,
    anchorUnitRequests: null,
    anchorUnitFilled: null,
  }));
}
