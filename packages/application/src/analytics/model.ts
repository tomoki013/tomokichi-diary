import type { Route } from "@tomokichi/domain";

export const ANALYTICS_SOURCES = ["ga4", "gsc_site", "gsc_url", "adsense", "affiliate"] as const;
export type AnalyticsSource = (typeof ANALYTICS_SOURCES)[number];
export type AnalyticsGrain =
  | "site"
  | "page"
  | "query"
  | "source"
  | "device"
  | "country"
  | "search_type"
  | "event"
  | "campaign"
  | "experience"
  | "ad_unit"
  /** Stored: visits by referrer, utm and new/returning, with the landing page as path. */
  | "entry"
  /** Derived from entry rows when read; never stored. */
  | "channel"
  | "referrer"
  | "landing";
export interface AnalyticsRow {
  grain: AnalyticsGrain;
  key: string;
  path: string | null;
  articleId: string | null;
  metrics: Record<string, number | null>;
}
export interface AnalyticsDay {
  source: AnalyticsSource;
  date: string;
  retrievedAt: string;
  provisional: boolean;
  rows: AnalyticsRow[];
}
export interface AnalyticsStatus {
  source: AnalyticsSource;
  attemptedAt: string | null;
  succeededAt: string | null;
  latestDate: string | null;
  start: string | null;
  end: string | null;
  error: string | null;
}
export interface DateRange {
  start: string;
  end: string;
}
export interface AnalyticsPeriodCounts extends DateRange {
  retrievedAt: string;
  coveredDays: number;
  expectedDays: number;
  metrics: Record<string, number>;
}
export type TrendBucket = "week" | "month";
export type TrendGrain = "site" | "channel" | "article" | "search_type";
/** Sums from the trend table. Every number is null when nothing was collected for it. */
export interface FactSums {
  pageViews: number | null;
  entrances: number | null;
  engagedEntrances: number | null;
  newEntrances: number | null;
  clicks: number | null;
  impressions: number | null;
  positionSum: number | null;
  earningsJPY: number | null;
}
export interface FactSeriesRow extends FactSums {
  source: AnalyticsSource;
  key: string;
  /** First day of the week (Monday) or month. */
  bucket: string;
  /** Days in the bucket that have a line for this key. */
  days: number;
}
export interface FactTotalRow {
  key: string;
  pageViews: number | null;
  clicks: number | null;
  entrances: number | null;
  recentPageViews: number | null;
  recentClicks: number | null;
  earlierPageViews: number | null;
  earlierClicks: number | null;
}
export interface AnalyticsStore {
  /** Bucketed sums for one grain; `keys` narrows to those lines. */
  factSeries?(
    grain: TrendGrain,
    range: DateRange,
    bucket: TrendBucket,
    keys?: readonly string[],
  ): Promise<FactSeriesRow[]>;
  /** Whole-range totals per key, and the same for the two halves being compared. */
  factTotals?(
    grain: TrendGrain,
    range: DateRange,
    earlier: DateRange,
    recent: DateRange,
  ): Promise<FactTotalRow[]>;
  readCounts?(ranges: DateRange[]): Promise<AnalyticsPeriodCounts[]>;
  read(range: DateRange): Promise<AnalyticsDay[]>;
  statuses(): Promise<AnalyticsStatus[]>;
}
export function validDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function shiftDate(date: string, days: number): string {
  if (!validDate(date)) throw new Error("ANALYTICS_INVALID_RANGE");
  return new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);
}
export function dateRange(start: string, end: string, maxDays = 93): DateRange {
  if (
    !validDate(start) ||
    !validDate(end) ||
    start > end ||
    (Date.parse(end) - Date.parse(start)) / 86400000 + 1 > maxDays
  )
    throw new Error("ANALYTICS_INVALID_RANGE");
  return { start, end };
}
export function dates(range: DateRange): string[] {
  dateRange(range.start, range.end, 3660);
  const result: string[] = [];
  for (let date = range.start; date <= range.end; date = shiftDate(date, 1)) result.push(date);
  return result;
}
export function previousRange(range: DateRange): DateRange {
  const length = dates(range).length;
  return { start: shiftDate(range.start, -length), end: shiftDate(range.start, -1) };
}
export function normalizeAnalyticsUrl(value: string): string | null {
  try {
    const url = new URL(value, "https://tomokichidiary.com");
    if (
      !["https:", "http:"].includes(url.protocol) ||
      !["tomokichidiary.com", "www.tomokichidiary.com"].includes(url.hostname) ||
      url.port ||
      url.username ||
      url.password
    )
      return null;
    return url.pathname.replace(/\/+$/, "") || "/";
  } catch {
    return null;
  }
}
export function resolveAnalyticsArticle(
  value: string,
  routes: readonly Route[],
): { path: string | null; articleId: string | null } {
  const path = normalizeAnalyticsUrl(value);
  if (!path) return { path: null, articleId: null };
  const byPath = new Map(routes.map((route) => [route.path as string, route]));
  let route = byPath.get(path);
  const visited = new Set<string>();
  while (route?.targetType === "redirect" && route.redirectTo) {
    if (visited.has(route.path)) return { path, articleId: null };
    visited.add(route.path);
    route = byPath.get(route.redirectTo);
  }
  if (route?.targetType !== "article" || !route.targetId) return { path, articleId: null };
  const canonical = routes.find(
    (r) =>
      r.targetType === "article" &&
      r.targetId === route.targetId &&
      r.isCanonical &&
      r.locale === route.locale,
  );
  return { path: canonical?.path ?? route.path, articleId: route.targetId };
}
export function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}
export function comparison(current: number | null, previous: number | null): number | null {
  return current !== null && previous !== null && previous > 0
    ? (current - previous) / previous
    : null;
}
const DISTINCT_COUNTS = new Set(["users", "activeUsers", "sessions", "engagedSessions"]);

/** Distinct counts cannot be added across dates or URL aliases. */
export function addMetrics(rows: readonly AnalyticsRow[]): Record<string, number | null> {
  const result: Record<string, number | null> = {};
  for (const row of rows) {
    const metrics = row.metrics;
    for (const key in metrics) {
      if (DISTINCT_COUNTS.has(key)) continue;
      const value = metrics[key];
      if (value !== null && value !== undefined) result[key] = (result[key] ?? 0) + value;
    }
  }
  if ("impressions" in result) {
    result["ctr"] = ratio(result["clicks"] ?? 0, result["impressions"] ?? 0);
    const weighted =
      result["positionSum"] != null
        ? ratio(result["positionSum"], result["impressions"] ?? 0)
        : null;
    result["position"] = weighted === null ? null : weighted + 1;
  }
  if ("estimatedEarningsJPY" in result) {
    const rpm = ratio(result["estimatedEarningsJPY"] ?? 0, result["adPageViews"] ?? 0);
    result["pageRPMJPY"] = rpm === null ? null : rpm * 1000;
    result["cpcJPY"] = ratio(result["estimatedEarningsJPY"] ?? 0, result["adClicks"] ?? 0);
    result["adCtr"] = ratio(result["adClicks"] ?? 0, result["adImpressions"] ?? 0);
  }
  return result;
}

/** The last week (Monday–Sunday) or month that has ended, in Japan time. */
export function completedRange(period: "weekly" | "monthly", now = new Date()) {
  const today = now.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  if (period === "monthly") {
    const end = shiftDate(`${today.slice(0, 7)}-01`, -1);
    return dateRange(`${end.slice(0, 7)}-01`, end);
  }
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const end = shiftDate(today, -((weekday + 6) % 7) - 1);
  return dateRange(shiftDate(end, -6), end);
}
