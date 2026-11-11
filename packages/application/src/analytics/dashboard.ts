import { acquisition } from "./acquisition.js";
import { articleReading } from "./articles.js";
import { experienceSummary } from "./experience.js";
import {
  ANALYTICS_SOURCES,
  addMetrics,
  dates,
  previousRange,
  shiftDate,
  type AnalyticsDay,
  type AnalyticsGrain,
  type AnalyticsPeriodCounts,
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
function project(
  days: AnalyticsDay[],
  range: DateRange,
  articleId?: string,
  counts: AnalyticsPeriodCounts[] = [],
) {
  const selected = days.filter((day) => day.date >= range.start && day.date <= range.end);
  return ANALYTICS_SOURCES.map((source) => {
    const sourceDays = selected.filter((day) => day.source === source);
    const rows = sourceDays.flatMap((day) => pageRows(day, articleId));
    const metrics: Record<string, number | null> | null = rows.length ? addMetrics(rows) : null;
    if (metrics && source === "ga4" && !articleId) {
      metrics["meanDailyUsers"] =
        rows.reduce((sum, row) => sum + (row.metrics["users"] ?? 0), 0) / rows.length;
      metrics["meanDailySessions"] =
        rows.reduce((sum, row) => sum + (row.metrics["sessions"] ?? 0), 0) / rows.length;
    }
    const count =
      !articleId && source === "ga4"
        ? counts.find((c) => c.start === range.start && c.end === range.end)
        : undefined;
    if (
      metrics &&
      count &&
      count.coveredDays > 0 &&
      count.coveredDays >= sourceDays.length &&
      sourceDays.every((day) => day.retrievedAt <= count.retrievedAt)
    )
      Object.assign(metrics, count.metrics, {
        uniqueCoveredDays: count.coveredDays,
        uniqueExpectedDays: count.expectedDays,
      });
    return {
      source,
      periodCountsRetrievedAt: count?.retrievedAt ?? null,
      metrics,
      coveredDays: sourceDays.length,
      expectedDays: dates(range).length,
      provisional:
        sourceDays.some((day) => day.provisional) ||
        Boolean(count && count.end > shiftDate(count.retrievedAt.slice(0, 10), -4)),
    };
  });
}
/** Parts of the dashboard a caller can ask for; the headline numbers always come. */
export const DASHBOARD_SECTIONS = [
  "daily",
  "articles",
  "pages",
  "queries",
  "breakdowns",
  "acquisition",
  "experience",
  "experiments",
] as const;
export type DashboardSection = (typeof DASHBOARD_SECTIONS)[number];
/** What a caller gets without naming sections: everything but the A/B test cohorts. */
export const DEFAULT_DASHBOARD_SECTIONS: readonly DashboardSection[] = DASHBOARD_SECTIONS.filter(
  (section) => section !== "experiments",
);

export interface DashboardOptions {
  readonly sections?: readonly DashboardSection[];
  /** Rows per list (articles, pages, queries, breakdowns, experiments). */
  readonly limit?: number;
  readonly offset?: number;
}

/** How much of one list was returned, so a cut is never silent. */
export interface ListPage {
  readonly total: number;
  readonly offset: number;
  readonly returned: number;
}

/** The row grains each section is built from; the headline numbers need only the first. */
function grainsFor(sections: ReadonlySet<DashboardSection>, articleId?: string): AnalyticsGrain[] {
  const grains = new Set<AnalyticsGrain>([articleId ? "page" : "site"]);
  const add = (...names: AnalyticsGrain[]) => names.forEach((name) => grains.add(name));
  if (sections.has("articles") && !articleId) add("page", "experience");
  if (sections.has("pages")) add("page");
  if (sections.has("queries")) add("query");
  if (sections.has("breakdowns"))
    add("source", "device", "event", "ad_unit", "country", "search_type");
  if (sections.has("acquisition")) add("entry");
  if (sections.has("experience") || sections.has("experiments")) add("experience");
  return [...grains];
}

const rowKey = (row: AnalyticsRow) =>
  row.grain === "page"
    ? (row.articleId ?? row.path ?? row.key)
    : `${row.path ?? ""}\u0000${row.key}`;

export async function analyticsDashboard(
  store: AnalyticsStore,
  range: DateRange,
  articleId?: string,
  options: DashboardOptions = {},
) {
  const sections = new Set(options.sections ?? DEFAULT_DASHBOARD_SECTIONS);
  const limit = options.limit ?? 20;
  const offset = options.offset ?? 0;
  const lists: Record<string, ListPage> = {};
  const page = <T>(name: string, items: readonly T[]): T[] => {
    const slice = items.slice(offset, offset + limit);
    lists[name] = { total: items.length, offset, returned: slice.length };
    return slice;
  };
  const previous = previousRange(range);
  const [days, statuses, counts] = await Promise.all([
    store.read({ start: previous.start, end: range.end }, grainsFor(sections, articleId)),
    store.statuses(),
    store.readCounts?.([range, previous]) ?? Promise.resolve([]),
  ]);
  const group = (grain: AnalyticsRow["grain"], source: AnalyticsSource, period = range) => {
    const grouped = new Map<string, AnalyticsRow[]>();
    for (const day of days) {
      if (day.source !== source || day.date < period.start || day.date > period.end) continue;
      for (const row of day.rows) {
        if (row.grain !== grain || (articleId && row.articleId !== articleId)) continue;
        const key = rowKey(row);
        const list = grouped.get(key);
        if (list) list.push(row);
        else grouped.set(key, [row]);
      }
    }
    return [...grouped.values()]
      .map((rows) => ({ ...rows[0]!, metrics: addMetrics(rows) }))
      .toSorted(
        (a, b) =>
          (b.metrics["pageViews"] ?? b.metrics["clicks"] ?? 0) -
          (a.metrics["pageViews"] ?? a.metrics["clicks"] ?? 0),
      );
  };
  /** The previous period's rows for exactly the current rows returned, to compare like with like. */
  const matching = (shown: readonly AnalyticsRow[], before: readonly AnalyticsRow[]) => {
    const keys = new Set(shown.map(rowKey));
    return before.filter((row) => keys.has(rowKey(row)));
  };
  const coverage = (period: DateRange) =>
    new Set(
      days
        .filter((day) => day.source === "ga4" && day.date >= period.start && day.date <= period.end)
        .filter((day) => day.rows.some((row) => row.grain === "experience"))
        .map((day) => day.date),
    ).size;

  const result: Record<string, unknown> = {
    range,
    previousRange: previous,
    /**
     * "site": search is in gsc_site. "article": search is in gsc_url and
     * gsc_site has no data (null), because Search Console has no per-page
     * site totals.
     */
    scope: articleId ? "article" : "site",
    current: project(days, range, articleId, counts),
    previous: project(days, previous, articleId, counts),
    statuses,
  };
  if (sections.has("daily"))
    result["daily"] = dates(range).map((date) => ({
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
    }));
  if (sections.has("articles"))
    result["articles"] = articleId ? [] : page("articles", articleReading(days, range, previous));
  if (sections.has("pages")) {
    const ga4 = page("pages.ga4", group("page", "ga4"));
    const gsc = page("pages.gsc", group("page", "gsc_url"));
    result["pages"] = { ga4, gsc };
    result["pagesPrevious"] = {
      ga4: matching(ga4, group("page", "ga4", previous)),
      gsc: matching(gsc, group("page", "gsc_url", previous)),
    };
  }
  if (sections.has("queries")) {
    const queries = page("queries", group("query", "gsc_url"));
    result["queries"] = queries;
    result["queriesPrevious"] = matching(queries, group("query", "gsc_url", previous));
  }
  if (sections.has("breakdowns"))
    result["breakdowns"] = {
      sources: page("breakdowns.sources", group("source", "ga4")),
      devices: page("breakdowns.devices", group("device", "ga4")),
      events: page("breakdowns.events", group("event", "ga4")),
      adUnits: page("breakdowns.adUnits", group("ad_unit", "adsense")),
      countries: page("breakdowns.countries", group("country", "gsc_site")),
      searchTypes: page("breakdowns.searchTypes", group("search_type", "gsc_site")),
    };
  if (sections.has("acquisition")) {
    const now = acquisition(days, range, articleId);
    result["acquisition"] = now && {
      coveredDays: now.coveredDays,
      channels: now.channels,
      channelsPrevious: acquisition(days, previous, articleId)?.channels ?? [],
      referrers: page("acquisition.referrers", now.referrers),
      landings: page("acquisition.landings", now.landings),
    };
  }
  if (sections.has("experience")) {
    result["readerCoverage"] = { currentDays: coverage(range), previousDays: coverage(previous) };
    result["experience"] = {
      current: experienceSummary(days, range, articleId),
      previous: experienceSummary(days, previous, articleId),
    };
  }
  if (sections.has("experiments")) {
    // Cohorts that have enough data to judge come first.
    const current = page(
      "experiments",
      experienceSummary(days, range, articleId, true).toSorted(
        (a, b) => Number(b.reviewReady) - Number(a.reviewReady),
      ),
    );
    const shown = new Set(
      current.map((c) =>
        JSON.stringify([c.articleId, c.layout, c.device, c.experimentId, c.variant]),
      ),
    );
    result["experiments"] = {
      current,
      previous: experienceSummary(days, previous, articleId, true).filter((c) =>
        shown.has(JSON.stringify([c.articleId, c.layout, c.device, c.experimentId, c.variant])),
      ),
    };
  }
  result["lists"] = lists;
  return result as unknown as DashboardResult;
}

type Cohorts<T> = { current: T[]; previous: T[] };
/** The dashboard; optional parts are present only when their section was asked for. */
export interface DashboardResult {
  range: DateRange;
  previousRange: DateRange;
  scope: "site" | "article";
  current: ReturnType<typeof project>;
  previous: ReturnType<typeof project>;
  statuses: Awaited<ReturnType<AnalyticsStore["statuses"]>>;
  lists: Record<string, ListPage>;
  daily?: unknown[];
  articles?: ReturnType<typeof articleReading>;
  pages?: { ga4: AnalyticsRow[]; gsc: AnalyticsRow[] };
  pagesPrevious?: { ga4: AnalyticsRow[]; gsc: AnalyticsRow[] };
  queries?: AnalyticsRow[];
  queriesPrevious?: AnalyticsRow[];
  breakdowns?: Record<string, AnalyticsRow[]>;
  acquisition?: {
    coveredDays: number;
    channels: AnalyticsRow[];
    channelsPrevious: AnalyticsRow[];
    referrers: AnalyticsRow[];
    landings: AnalyticsRow[];
  } | null;
  readerCoverage?: { currentDays: number; previousDays: number };
  experience?: Cohorts<ReturnType<typeof experienceSummary>[number]>;
  experiments?: Cohorts<ReturnType<typeof experienceSummary>[number]>;
}
export type AnalyticsDashboard = Awaited<ReturnType<typeof analyticsDashboard>>;
