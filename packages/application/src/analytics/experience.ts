import {
  addMetrics,
  ratio,
  type AnalyticsDay,
  type AnalyticsRow,
  type DateRange,
} from "./model.js";
export function experienceSummary(
  days: AnalyticsDay[],
  range: DateRange,
  articleId?: string,
  experiments = false,
) {
  const cohorts = new Map<
    string,
    {
      layout: string;
      device: string;
      experimentId: string;
      variant: string;
      rows: AnalyticsRow[];
      dates: Set<string>;
    }
  >();
  for (const day of days) {
    if (day.source !== "ga4" || day.date < range.start || day.date > range.end) continue;
    for (const row of day.rows) {
      if (row.grain !== "experience" || (articleId && row.articleId !== articleId)) continue;
      let dimensions: { layout: string; device: string; experimentId: string; variant: string };
      try {
        dimensions = JSON.parse(row.key);
      } catch {
        continue;
      }
      if (
        (experiments
          ? dimensions.layout !== "article-placement-v2" ||
            dimensions.experimentId !== "chagee-placement-v1" ||
            !["A", "B"].includes(dimensions.variant)
          : !(
              dimensions.layout === "article-end-v1" ||
              (dimensions.layout === "article-placement-v2" &&
                dimensions.experimentId === "none" &&
                dimensions.variant === "none")
            )) ||
        !["mobile", "desktop", "tablet"].includes(dimensions.device)
      )
        continue;
      const key = JSON.stringify([
        dimensions.layout,
        dimensions.device,
        dimensions.experimentId,
        dimensions.variant,
      ]);
      const cohort = cohorts.get(key) ?? { ...dimensions, rows: [], dates: new Set<string>() };
      cohort.rows.push(row);
      if (JSON.parse(row.key).measurement === "article_view") cohort.dates.add(day.date);
      cohorts.set(key, cohort);
    }
  }
  return [...cohorts.values()]
    .map((cohort) => {
      const sum = (measurement: string, placement?: string, vital?: string) =>
        addMetrics(
          cohort.rows.filter((row) => {
            const d = JSON.parse(row.key);
            return (
              d.measurement === measurement &&
              (!placement || d.placement === placement) &&
              (!vital || d.vital === vital)
            );
          }),
        );
      const count = (m: string, p?: string) => sum(m, p)["observations"] ?? 0;
      const views = count("article_view");
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
        visibleMsPerView: ratio(sum("visible_time")["valueSum"] ?? 0, views),
        nextArticleRate: ratio(count("next_article"), views),
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
    .toSorted((a, b) => b.views - a.views);
}
