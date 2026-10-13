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
  | "ad_unit";
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
export interface AnalyticsStore {
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
/** Distinct counts cannot be added across dates or URL aliases. */
export function addMetrics(rows: readonly AnalyticsRow[]): Record<string, number | null> {
  const result: Record<string, number | null> = {};
  for (const row of rows)
    for (const [key, value] of Object.entries(row.metrics)) {
      if (["users", "activeUsers", "sessions", "engagedSessions"].includes(key)) continue;
      if (value !== null) result[key] = (result[key] ?? 0) + value;
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
