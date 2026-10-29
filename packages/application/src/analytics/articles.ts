import {
  addMetrics,
  ratio,
  type AnalyticsDay,
  type AnalyticsRow,
  type DateRange,
} from "./model.js";

const inRange = (date: string, r: DateRange) => date >= r.start && date <= r.end;

/**
 * One line per article for the period: how far readers got (from the reader
 * measurements, every layout and test arm together), whether they went on to
 * another article, what search brought, and what the page earned. Search is
 * also given for the previous period so a fall stands out.
 */
export function articleReading(days: AnalyticsDay[], range: DateRange, previous: DateRange) {
  const byArticle = new Map<
    string,
    {
      path: string | null;
      experience: AnalyticsRow[];
      ga4: AnalyticsRow[];
      gsc: AnalyticsRow[];
      gscPrevious: AnalyticsRow[];
      adsense: AnalyticsRow[];
    }
  >();
  const entry = (row: AnalyticsRow) => {
    const id = row.articleId!;
    const found = byArticle.get(id) ?? {
      path: row.path,
      experience: [],
      ga4: [],
      gsc: [],
      gscPrevious: [],
      adsense: [],
    };
    found.path ??= row.path;
    byArticle.set(id, found);
    return found;
  };
  for (const day of days) {
    const current = inRange(day.date, range);
    if (!current && !(day.source === "gsc_url" && inRange(day.date, previous))) continue;
    for (const row of day.rows) {
      if (!row.articleId) continue;
      if (day.source === "ga4" && row.grain === "experience") entry(row).experience.push(row);
      else if (day.source === "ga4" && row.grain === "page") entry(row).ga4.push(row);
      else if (day.source === "gsc_url" && row.grain === "page")
        (current ? entry(row).gsc : entry(row).gscPrevious).push(row);
      else if (day.source === "adsense" && row.grain === "page") entry(row).adsense.push(row);
    }
  }
  return [...byArticle]
    .map(([articleId, rows]) => {
      const count = (measurement: string) =>
        rows.experience
          .filter((row) => {
            try {
              return JSON.parse(row.key).measurement === measurement;
            } catch {
              return false;
            }
          })
          .reduce((sum, row) => sum + (row.metrics["observations"] ?? 0), 0);
      const views = count("article_view");
      const gsc = addMetrics(rows.gsc),
        gscPrevious = addMetrics(rows.gscPrevious);
      return {
        articleId,
        path: rows.path,
        pageViews: addMetrics(rows.ga4)["pageViews"] ?? null,
        measuredViews: views,
        body75Rate: ratio(count("body_75"), views),
        bodyEndRate: ratio(count("body_end"), views),
        nextArticleRate: ratio(count("next_article"), views),
        clicks: gsc["clicks"] ?? null,
        clicksPrevious: gscPrevious["clicks"] ?? null,
        impressions: gsc["impressions"] ?? null,
        position: gsc["position"] ?? null,
        positionPrevious: gscPrevious["position"] ?? null,
        earningsJPY: addMetrics(rows.adsense)["estimatedEarningsJPY"] ?? null,
      };
    })
    .filter((row) => (row.pageViews ?? 0) > 0 || row.measuredViews > 0 || (row.clicks ?? 0) > 0)
    .toSorted((a, b) => (b.pageViews ?? b.measuredViews) - (a.pageViews ?? a.measuredViews));
}
