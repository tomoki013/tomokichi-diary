export interface AnalyticsMetricRowDto {
  grain: string;
  key: string;
  path: string | null;
  articleId: string | null;
  metrics: Record<string, number | null>;
}
export interface AnalyticsDashboardDto {
  range: { start: string; end: string };
  previousRange: { start: string; end: string };
  current: {
    source: string;
    metrics: Record<string, number | null>;
    coveredDays: number;
    expectedDays: number;
    provisional: boolean;
  }[];
  previous: AnalyticsDashboardDto["current"];
  statuses: {
    source: string;
    attemptedAt: string | null;
    succeededAt: string | null;
    latestDate: string | null;
    start: string | null;
    end: string | null;
    error: string | null;
  }[];
  daily: {
    date: string;
    sources: {
      source: string;
      metrics: Record<string, number | null> | null;
      provisional: boolean | null;
    }[];
  }[];
  pages: { ga4: AnalyticsMetricRowDto[]; gsc: AnalyticsMetricRowDto[] };
  pagesPrevious: AnalyticsDashboardDto["pages"];
  queries: AnalyticsMetricRowDto[];
  breakdowns: {
    sources: AnalyticsMetricRowDto[];
    devices: AnalyticsMetricRowDto[];
    events: AnalyticsMetricRowDto[];
    countries: AnalyticsMetricRowDto[];
    searchTypes: AnalyticsMetricRowDto[];
  };
}
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const textOrNull = (v: unknown) => v === null || typeof v === "string";
/** Reject malformed private payloads before they can replace a successful day. */
export function assertAnalyticsDay(value: unknown): void {
  if (
    !record(value) ||
    !["ga4", "gsc_site", "gsc_url", "adsense", "affiliate"].includes(String(value["source"])) ||
    typeof value["date"] !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value["date"]) ||
    !Number.isFinite(Date.parse(value["date"])) ||
    new Date(value["date"]).toISOString().slice(0, 10) !== value["date"] ||
    typeof value["retrievedAt"] !== "string" ||
    !Number.isFinite(Date.parse(value["retrievedAt"])) ||
    typeof value["provisional"] !== "boolean" ||
    !Array.isArray(value["rows"])
  )
    throw new Error("ANALYTICS_INVALID_DATA");
  const keys = new Set<string>();
  for (const row of value["rows"]) {
    if (
      !record(row) ||
      ![
        "site",
        "page",
        "query",
        "source",
        "device",
        "country",
        "search_type",
        "event",
        "campaign",
      ].includes(String(row["grain"])) ||
      typeof row["key"] !== "string" ||
      row["key"].length > 4096 ||
      !textOrNull(row["path"]) ||
      !textOrNull(row["articleId"]) ||
      !record(row["metrics"])
    )
      throw new Error("ANALYTICS_INVALID_DATA");
    const key = JSON.stringify([row["grain"], row["key"], row["path"]]);
    if (keys.has(key)) throw new Error("ANALYTICS_DUPLICATE_ROW");
    keys.add(key);
    for (const [metric, number] of Object.entries(row["metrics"])) {
      if (
        !/^[A-Za-z][A-Za-z0-9]{0,50}$/.test(metric) ||
        (number !== null && (typeof number !== "number" || !Number.isFinite(number) || number < 0))
      )
        throw new Error("ANALYTICS_INVALID_METRIC");
    }
    for (const metric of [
      "pageViews",
      "users",
      "activeUsers",
      "sessions",
      "engagedSessions",
      "engagementMs",
      "eventCount",
      "clicks",
      "impressions",
      "positionSum",
      "adImpressions",
      "adPageViews",
      "adClicks",
      "linkClicks",
      "pendingConversions",
      "confirmedConversions",
    ]) {
      const number = row["metrics"][metric];
      if (number != null && (typeof number !== "number" || !Number.isSafeInteger(number)))
        throw new Error("ANALYTICS_INVALID_METRIC");
    }
    const clicks = row["metrics"]["clicks"],
      impressions = row["metrics"]["impressions"];
    if (typeof clicks === "number" && typeof impressions === "number" && clicks > impressions)
      throw new Error("ANALYTICS_INVALID_METRIC");
  }
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 800000)
    throw new Error("ANALYTICS_DAY_TOO_LARGE");
}

export interface AnalyticsReportDto {
  period: string;
  start: string;
  end: string;
  generatedAt: string;
  current: AnalyticsDashboardDto["current"];
  previous: AnalyticsDashboardDto["current"];
  ai: { enabled: boolean; reason: string };
}
