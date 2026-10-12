import {
  ANALYTICS_SOURCES,
  addMetrics,
  dates,
  previousRange,
  type AnalyticsDay,
  type AnalyticsRow,
  type AnalyticsSource,
  type AnalyticsStore,
  type DateRange,
} from "./model.js";

function pageRows(day: AnalyticsDay, articleId?: string): AnalyticsRow[] {
  const rows = day.rows.filter((row) =>
    articleId ? row.articleId === articleId && row.grain === "page" : row.grain === "site",
  );
  if (!rows.length && articleId && ["ga4", "gsc_url", "affiliate"].includes(day.source)) {
    const metrics: AnalyticsRow["metrics"] =
      day.source === "ga4"
        ? { pageViews: 0, engagementMs: 0, eventCount: 0 }
        : day.source === "gsc_url"
          ? { clicks: 0, impressions: 0, positionSum: 0 }
          : {
              linkClicks: 0,
              confirmedConversions: 0,
              pendingConversions: 0,
              confirmedRewardJPY: 0,
              pendingRewardJPY: 0,
            };
    return [{ grain: "page", key: articleId, path: null, articleId, metrics }];
  }
  return rows;
}
function project(days: AnalyticsDay[], range: DateRange, articleId?: string) {
  const selected = days.filter((day) => day.date >= range.start && day.date <= range.end);
  return ANALYTICS_SOURCES.map((source) => {
    const sourceDays = selected.filter((day) => day.source === source);
    const rows = sourceDays.flatMap((day) => pageRows(day, articleId));
    const metrics = rows.length ? addMetrics(rows) : {};
    if (source === "ga4" && !articleId && rows.length) {
      metrics["meanDailyUsers"] =
        rows.reduce((sum, row) => sum + (row.metrics["users"] ?? 0), 0) / rows.length;
      metrics["meanDailySessions"] =
        rows.reduce((sum, row) => sum + (row.metrics["sessions"] ?? 0), 0) / rows.length;
    }
    return {
      source,
      metrics,
      coveredDays: sourceDays.length,
      expectedDays: dates(range).length,
      provisional: sourceDays.some((day) => day.provisional),
    };
  });
}
export async function analyticsDashboard(
  store: AnalyticsStore,
  range: DateRange,
  articleId?: string,
) {
  const previous = previousRange(range);
  const [days, statuses] = await Promise.all([
    store.read({ start: previous.start, end: range.end }),
    store.statuses(),
  ]);
  const group = (grain: AnalyticsRow["grain"], source: AnalyticsSource, period = range) => {
    const grouped = new Map<string, AnalyticsRow[]>();
    for (const day of days.filter(
      (d) => d.date >= period.start && d.date <= period.end && d.source === source,
    )) {
      for (const row of day.rows.filter(
        (r) => r.grain === grain && (!articleId || r.articleId === articleId),
      )) {
        const key =
          grain === "page"
            ? (row.articleId ?? row.path ?? row.key)
            : `${row.path ?? ""}\u0000${row.key}`;
        grouped.set(key, [...(grouped.get(key) ?? []), row]);
      }
    }
    return [...grouped.values()]
      .map((rows) => ({ ...rows[0]!, metrics: addMetrics(rows) }))
      .toSorted(
        (a, b) =>
          (b.metrics["pageViews"] ?? b.metrics["clicks"] ?? 0) -
          (a.metrics["pageViews"] ?? a.metrics["clicks"] ?? 0),
      )
      .slice(0, 100);
  };
  return {
    range,
    previousRange: previous,
    current: project(days, range, articleId),
    previous: project(days, previous, articleId),
    statuses,
    daily: dates(range).map((date) => ({
      date,
      sources: ANALYTICS_SOURCES.map((source) => {
        const day = days.find((d) => d.date === date && d.source === source);
        const rows = day ? pageRows(day, articleId) : undefined;
        return {
          source,
          metrics: rows?.length
            ? source === "ga4" && !articleId
              ? { ...rows[0]!.metrics }
              : addMetrics(rows)
            : null,
          provisional: day?.provisional ?? null,
        };
      }),
    })),
    pages: { ga4: group("page", "ga4"), gsc: group("page", "gsc_url") },
    pagesPrevious: { ga4: group("page", "ga4", previous), gsc: group("page", "gsc_url", previous) },
    queries: group("query", "gsc_url"),
    breakdowns: {
      sources: group("source", "ga4"),
      devices: group("device", "ga4"),
      events: group("event", "ga4"),
      countries: group("country", "gsc_site"),
      searchTypes: group("search_type", "gsc_site"),
    },
  };
}
export type AnalyticsDashboard = Awaited<ReturnType<typeof analyticsDashboard>>;
