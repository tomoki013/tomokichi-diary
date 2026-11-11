import {
  ANALYTICS_SOURCES,
  dateRange,
  dates,
  ratio,
  shiftDate,
  type AnalyticsStore,
  type DateRange,
  type FactSeriesRow,
  type FactSums,
  type FactTotalRow,
  type TrendBucket,
  type TrendGrain,
} from "./model.js";

export const TREND_MAX_DAYS = 800;
export const TREND_SORTS = ["total", "decline", "growth"] as const;
export type TrendSort = (typeof TREND_SORTS)[number];

export interface TrendOptions {
  readonly bucket?: TrendBucket;
  readonly by?: TrendGrain;
  /** Only this line (an article id, a channel, a search type). */
  readonly key?: string;
  readonly sort?: TrendSort;
  readonly limit?: number;
  readonly offset?: number;
}

/** First day of the week (Monday) or month a date falls in. */
export function bucketStart(date: string, bucket: TrendBucket): string {
  if (bucket === "month") return `${date.slice(0, 7)}-01`;
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return shiftDate(date, -((weekday + 6) % 7));
}
function bucketEnd(start: string, bucket: TrendBucket): string {
  if (bucket === "week") return shiftDate(start, 6);
  return shiftDate(`${shiftDate(start, 31).slice(0, 7)}-01`, -1);
}

const SUMS = [
  "pageViews",
  "entrances",
  "engagedEntrances",
  "newEntrances",
  "clicks",
  "impressions",
  "earningsJPY",
] as const satisfies readonly (keyof FactSums)[];

const weight = (row: FactTotalRow) => row.pageViews ?? row.entrances ?? row.clicks ?? 0;
/** Recent half minus the earlier half: page views where there are any, else search clicks. */
const change = (row: FactTotalRow) =>
  row.pageViews !== null
    ? (row.recentPageViews ?? 0) - (row.earlierPageViews ?? 0)
    : (row.recentClicks ?? 0) - (row.earlierClicks ?? 0);

/**
 * The long view: weekly or monthly sums for up to 800 days, for the site, per
 * channel, per search type or per article. Everything here is additive, so a
 * bucket is a plain sum of its days. Values are arrays aligned with `buckets`;
 * `null` means nothing was collected for that bucket, never zero.
 */
export async function analyticsTrend(
  store: AnalyticsStore,
  requested: DateRange,
  options: TrendOptions = {},
) {
  const range = dateRange(requested.start, requested.end, TREND_MAX_DAYS);
  const bucket = options.bucket ?? "week";
  const by = options.by ?? "site";
  const limit = options.limit ?? 20;
  const offset = options.offset ?? 0;
  const sort = options.sort ?? "total";
  if (!store.factSeries || !store.factTotals) throw new Error("ANALYTICS_TREND_UNAVAILABLE");

  const buckets: { start: string; end: string; days: number; complete: boolean }[] = [];
  for (
    let start = bucketStart(range.start, bucket);
    start <= range.end;
    start = shiftDate(bucketEnd(start, bucket), 1)
  ) {
    const end = bucketEnd(start, bucket);
    const from = start < range.start ? range.start : start;
    const to = end > range.end ? range.end : end;
    buckets.push({
      start,
      end,
      days: dates({ start: from, end: to }).length,
      complete: from === start && to === end,
    });
  }
  const index = new Map(buckets.map((b, i) => [b.start, i]));

  // The two halves compared for "decline"/"growth": the latest complete
  // buckets against the same number just before them.
  const complete = buckets.filter((b) => b.complete);
  const half = Math.floor(complete.length / 2);
  const recent = half
    ? { start: complete.at(-half)!.start, end: complete.at(-1)!.end }
    : { start: range.end, end: range.end };
  const earlier = half
    ? { start: complete.at(-2 * half)!.start, end: complete.at(-half - 1)!.end }
    : { start: range.start, end: range.start };

  let totals: FactTotalRow[];
  if (by === "site") totals = [];
  else {
    totals = await store.factTotals(by, range, earlier, recent);
    if (options.key !== undefined) totals = totals.filter((row) => row.key === options.key);
    totals.sort((a, b) =>
      sort === "decline"
        ? change(a) - change(b)
        : sort === "growth"
          ? change(b) - change(a)
          : weight(b) - weight(a),
    );
  }
  const shown = by === "site" ? [] : totals.slice(offset, offset + limit);
  const [rows, siteRows] = await Promise.all([
    by === "site" || shown.length
      ? store.factSeries(by, range, bucket, by === "site" ? undefined : shown.map((r) => r.key))
      : Promise.resolve([] as FactSeriesRow[]),
    by === "site" ? Promise.resolve(null) : store.factSeries("site", range, bucket),
  ]);

  const series = (key: string, total?: FactTotalRow) => {
    const values: Record<string, (number | null)[]> = {};
    const positionSum: (number | null)[] = buckets.map(() => null);
    for (const row of rows) {
      if (row.key !== key) continue;
      const at = index.get(row.bucket);
      if (at === undefined) continue;
      for (const name of SUMS) {
        const value = row[name];
        if (value === null) continue;
        const list = (values[name] ??= buckets.map(() => null));
        list[at] = (list[at] ?? 0) + value;
      }
      if (row.positionSum !== null) positionSum[at] = (positionSum[at] ?? 0) + row.positionSum;
    }
    const impressions = values["impressions"];
    if (impressions) {
      values["ctr"] = impressions.map((n, i) =>
        n === null ? null : ratio(values["clicks"]?.[i] ?? 0, n),
      );
      values["position"] = impressions.map((n, i) => {
        const sum = positionSum[i];
        const mean = n === null || sum === null || sum === undefined ? null : ratio(sum, n);
        return mean === null ? null : mean + 1;
      });
    }
    return {
      key,
      ...(total
        ? {
            compared: {
              pageViews: { earlier: total.earlierPageViews, recent: total.recentPageViews },
              clicks: { earlier: total.earlierClicks, recent: total.recentClicks },
            },
          }
        : {}),
      values,
    };
  };

  // Days each source has in each bucket, so a thin bucket is not read as a fall.
  const coverageRows = siteRows ?? rows;
  const coverage = ANALYTICS_SOURCES.map((source) => {
    const days = buckets.map(() => 0);
    for (const row of coverageRows) {
      const at = index.get(row.bucket);
      if (row.source === source && at !== undefined) days[at] = Math.max(days[at]!, row.days);
    }
    return { source, days };
  }).filter((entry) => entry.days.some((n) => n > 0));

  return {
    range,
    bucket,
    by,
    buckets,
    coverage,
    compared: half ? { earlier, recent } : null,
    series: by === "site" ? [series("")] : shown.map((total) => series(total.key, total)),
    list: by === "site" ? null : { total: totals.length, offset, returned: shown.length },
  };
}
export type AnalyticsTrend = Awaited<ReturnType<typeof analyticsTrend>>;
