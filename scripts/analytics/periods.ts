import {
  dateRange,
  dates,
  previousRange,
  shiftDate,
  type DateRange,
  type AnalyticsPeriodCounts,
} from "@tomokichi/application";
import { mkdirSync, writeFileSync } from "node:fs";
import { d1 } from "./cloudflare.js";
import { BigQuery } from "./bigquery.js";
export function periodWindows(requested: DateRange): DateRange[] {
  dateRange(requested.start, requested.end, 93);
  const sunday = shiftDate(requested.end, -new Date(requested.end).getUTCDay());
  const previousMonthEnd = shiftDate(`${requested.end.slice(0, 7)}-01`, -1);
  const current = [
    { start: shiftDate(sunday, -6), end: sunday },
    { start: `${previousMonthEnd.slice(0, 7)}-01`, end: previousMonthEnd },
    requested,
    ...[7, 28, 90].map((length) => ({
      start: shiftDate(requested.end, 1 - length),
      end: requested.end,
    })),
    { start: `${requested.end.slice(0, 7)}-01`, end: requested.end },
  ];
  const all = [...current, ...current.map(previousRange)];
  return [...new Map(all.map((range) => [`${range.start}/${range.end}`, range])).values()];
}
export async function collectPeriodCounts(
  bq: BigQuery,
  requested: DateRange,
  persist: boolean,
  dryRun = false,
) {
  const windows = periodWindows(requested);
  const scan = { start: windows.map((w) => w.start).toSorted()[0]!, end: requested.end };
  const rows = await bq.query("ga4_periods", scan, dryRun, { windows: JSON.stringify(windows) });
  if (dryRun) return [];
  const now = new Date().toISOString();
  const counts: AnalyticsPeriodCounts[] = rows.map((row) => ({
    start: row["start"]!,
    end: row["end"]!,
    retrievedAt: now,
    coveredDays: Number(row["coveredDays"]),
    expectedDays: dates({ start: row["start"]!, end: row["end"]! }).length,
    metrics: Object.fromEntries(
      ["users", "activeUsers", "sessions", "engagedSessions"].map((key) => [key, Number(row[key])]),
    ),
  }));
  if (
    counts.length !== windows.length ||
    new Set(counts.map((c) => `${c.start}/${c.end}`)).size !== counts.length ||
    counts.some(
      (c) =>
        !windows.some((w) => w.start === c.start && w.end === c.end) ||
        !Number.isSafeInteger(c.coveredDays) ||
        c.coveredDays < 0 ||
        c.coveredDays > c.expectedDays ||
        Object.values(c.metrics).some((n) => !Number.isSafeInteger(n) || n < 0),
    )
  )
    throw new Error("ANALYTICS_INVALID_COUNTS");
  if (persist)
    await d1(
      counts.map((count) => ({
        sql: "INSERT INTO analytics_period_counts(start,end,payload) VALUES(?,?,?) ON CONFLICT(start,end) DO UPDATE SET payload=excluded.payload",
        params: [count.start, count.end, JSON.stringify(count)],
      })),
    );
  if (!persist) {
    mkdirSync(".data/analytics", { recursive: true });
    writeFileSync(".data/analytics/period-counts.json", JSON.stringify(counts));
  }
  process.stdout.write(`ga4 period counts: ${counts.length} windows validated\n`);
  return counts;
}
