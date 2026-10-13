import {
  addMetrics,
  ratio,
  type AnalyticsDay,
  type AnalyticsRow,
  type DateRange,
} from "./model.js";
export function experienceSummary(days: AnalyticsDay[], range: DateRange, articleId?: string) {
  const cohorts = new Map<
    string,
    { layout: string; device: string; rows: AnalyticsRow[]; dates: Set<string> }
  >();
  for (const day of days) {
    if (day.source !== "ga4" || day.date < range.start || day.date > range.end) continue;
    for (const row of day.rows) {
      if (row.grain !== "experience" || (articleId && row.articleId !== articleId)) continue;
      let dimensions: { layout: string; device: string };
      try {
        dimensions = JSON.parse(row.key);
      } catch {
        continue;
      }
      if (
        dimensions.layout !== "article-end-v1" ||
        !["mobile", "desktop", "tablet"].includes(dimensions.device)
      )
        continue;
      const key = JSON.stringify([dimensions.layout, dimensions.device]);
      const cohort = cohorts.get(key) ?? { ...dimensions, rows: [], dates: new Set<string>() };
      cohort.rows.push(row);
      cohort.dates.add(day.date);
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
        device: cohort.device,
        measuredDays: cohort.dates.size,
        firstDate: [...cohort.dates].toSorted()[0]!,
        lastDate: [...cohort.dates].toSorted().at(-1)!,
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
