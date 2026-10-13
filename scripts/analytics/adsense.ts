import { assertAnalyticsDay } from "@tomokichi/contracts";
import { dates, type AnalyticsDay, type DateRange } from "@tomokichi/application";
import { requestJson } from "./http.js";

interface AdSenseReport {
  headers?: { name: string; currencyCode?: string }[];
  rows?: { cells: { value: string }[] }[];
  totalMatchedRows?: string;
  warnings?: string[];
  startDate?: { year: number; month: number; day: number };
  endDate?: { year: number; month: number; day: number };
}
export function adsenseUrl(account: string, range: DateRange, units = false): string {
  if (!/^accounts\/pub-\d+$/.test(account)) throw new Error("ANALYTICS_ADSENSE_ACCOUNT");
  const url = new URL(`https://adsense.googleapis.com/v2/${account}/reports:generate`);
  url.searchParams.set("dateRange", "CUSTOM");
  url.searchParams.set("currencyCode", "JPY");
  url.searchParams.append("dimensions", "DATE");
  if (units) url.searchParams.append("dimensions", "AD_UNIT_ID");
  // Scope shared AdSense accounts to this site; never collect another site's earnings.
  url.searchParams.append("filters", "OWNED_SITE_DOMAIN_NAME==tomokichidiary.com");
  for (const metric of ["ESTIMATED_EARNINGS", "IMPRESSIONS", "PAGE_VIEWS", "CLICKS"])
    url.searchParams.append("metrics", metric);
  url.searchParams.append("metrics", "AD_REQUESTS");
  for (const [key, date] of Object.entries(range)) {
    const [year, month, day] = date.split("-");
    url.searchParams.set(`${key}Date.year`, year!);
    url.searchParams.set(`${key}Date.month`, month!);
    url.searchParams.set(`${key}Date.day`, day!);
  }
  return url.href;
}
export function parseAdSense(report: AdSenseReport, range: DateRange, now: string): AnalyticsDay[] {
  if (
    Number(report.totalMatchedRows ?? 0) !== (report.rows ?? []).length ||
    report.warnings?.length
  )
    throw new Error("ANALYTICS_ADSENSE_INCOMPLETE");
  const headers = report.headers ?? [];
  const required = ["DATE", "ESTIMATED_EARNINGS", "IMPRESSIONS", "PAGE_VIEWS", "CLICKS"];
  if (!required.every((name) => headers.some((h) => h.name === name))) {
    if (!report.rows?.length && report.totalMatchedRows === "0") return []; // Account with no report yet: missing, not invented zero revenue.
    throw new Error("ANALYTICS_ADSENSE_SCHEMA");
  }
  if (headers.find((h) => h.name === "ESTIMATED_EARNINGS")?.currencyCode !== "JPY")
    throw new Error("ANALYTICS_ADSENSE_CURRENCY");
  const output: AnalyticsDay[] = [];
  const seen = new Set<string>();
  const allowed = new Set(dates(range));
  for (const row of report.rows ?? []) {
    const cells = Object.fromEntries(headers.map((h, i) => [h.name, row.cells[i]?.value]));
    const date = cells["DATE"] ?? "";
    if (!allowed.has(date) || seen.has(date)) throw new Error("ANALYTICS_ADSENSE_INCOMPLETE");
    seen.add(date);
    const day: AnalyticsDay = {
      source: "adsense",
      date,
      retrievedAt: now,
      provisional: true,
      rows: [
        {
          grain: "site",
          key: "JPY",
          path: null,
          articleId: null,
          metrics: {
            estimatedEarningsJPY: Number(cells["ESTIMATED_EARNINGS"]),
            adImpressions: Number(cells["IMPRESSIONS"]),
            adPageViews: Number(cells["PAGE_VIEWS"]),
            adClicks: Number(cells["CLICKS"]),
            ...(headers.some((h) => h.name === "AD_REQUESTS")
              ? { adRequests: Number(cells["AD_REQUESTS"]) }
              : {}),
          },
        },
      ],
    };
    assertAnalyticsDay(day);
    output.push(day);
  }
  return output;
}
export function parseAdSenseUnits(
  report: AdSenseReport,
  range: DateRange,
  now: string,
): AnalyticsDay[] {
  const headers = report.headers ?? [];
  if (!headers.some((h) => h.name === "AD_UNIT_ID")) {
    if (!report.rows?.length && report.totalMatchedRows === "0") return [];
    throw new Error("ANALYTICS_ADSENSE_SCHEMA");
  }
  if (!headers.some((h) => h.name === "AD_REQUESTS")) throw new Error("ANALYTICS_ADSENSE_SCHEMA");
  if (
    Number(report.totalMatchedRows ?? 0) !== (report.rows ?? []).length ||
    report.warnings?.length
  )
    throw new Error("ANALYTICS_ADSENSE_INCOMPLETE");
  const byDate = new Map<string, AnalyticsDay>();
  for (const row of report.rows ?? []) {
    const id = row.cells[headers.findIndex((h) => h.name === "AD_UNIT_ID")]?.value;
    if (!id || !/^[a-zA-Z0-9:_-]{1,100}$/.test(id)) throw new Error("ANALYTICS_ADSENSE_SCHEMA");
    const day = parseAdSense({ ...report, rows: [row], totalMatchedRows: "1" }, range, now)[0]!;
    const record = day.rows[0]!;
    record.grain = "ad_unit";
    record.key = id;
    record.metrics["adRequests"] = Number(
      row.cells[headers.findIndex((h) => h.name === "AD_REQUESTS")]?.value,
    );
    const existing = byDate.get(day.date);
    if (existing) existing.rows.push(record);
    else byDate.set(day.date, day);
  }
  for (const day of byDate.values()) assertAnalyticsDay(day);
  return [...byDate.values()];
}
export async function fetchAdSense(range: DateRange): Promise<AnalyticsDay[] | null> {
  if (process.env["ADSENSE_ENABLED"] !== "1") return null;
  const clientId = process.env["ADSENSE_CLIENT_ID"],
    clientSecret = process.env["ADSENSE_CLIENT_SECRET"],
    refreshToken = process.env["ADSENSE_REFRESH_TOKEN"],
    account = process.env["ADSENSE_ACCOUNT"];
  if (!clientId || !clientSecret || !refreshToken || !account)
    throw new Error("ANALYTICS_ADSENSE_UNCONFIGURED");
  const token = await requestJson<{ access_token: string }>("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!token.access_token) throw new Error("ANALYTICS_ADSENSE_UNCONFIGURED");
  const now = new Date().toISOString();
  const days = parseAdSense(
    await requestJson<AdSenseReport>(adsenseUrl(account, range), {
      headers: { authorization: `Bearer ${token.access_token}` },
    }),
    range,
    now,
  );
  const units = parseAdSenseUnits(
    await requestJson<AdSenseReport>(adsenseUrl(account, range, true), {
      headers: { authorization: `Bearer ${token.access_token}` },
    }),
    range,
    now,
  );
  for (const unit of units) {
    const day = days.find((d) => d.date === unit.date);
    if (!day) throw new Error("ANALYTICS_ADSENSE_INCOMPLETE");
    day.rows.push(...unit.rows);
    assertAnalyticsDay(day);
  }
  return days;
}
