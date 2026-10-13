import {
  analyticsDashboard,
  dateRange,
  shiftDate,
  type AnalyticsDay,
  type AnalyticsPeriodCounts,
  type AnalyticsStatus,
} from "@tomokichi/application";
import { d1 } from "./cloudflare.js";
const period = process.argv[2];
if (!["weekly", "monthly"].includes(period ?? "")) throw new Error("ANALYTICS_INVALID_RANGE");
const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
let start: string, end: string;
if (period === "weekly") {
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  end = shiftDate(today, -((weekday + 6) % 7) - 1);
  start = shiftDate(end, -6);
} else {
  end = shiftDate(`${today.slice(0, 7)}-01`, -1);
  start = `${end.slice(0, 7)}-01`;
}
const range = dateRange(start, end);
const dashboard = await analyticsDashboard(
  {
    read: async (r) =>
      (
        await d1<{ payload: string }>([
          {
            sql: "SELECT payload FROM analytics_days WHERE date BETWEEN ? AND ?",
            params: [r.start, r.end],
          },
        ])
      )[0]!.map((stored) => JSON.parse(stored.payload) as AnalyticsDay),
    statuses: async () => [] as AnalyticsStatus[],
    readCounts: async (ranges) =>
      (
        await d1<{ payload: string }>([
          {
            sql: `SELECT payload FROM analytics_period_counts WHERE ${ranges.map(() => "(start=? AND end=?)").join(" OR ")}`,
            params: ranges.flatMap((r) => [r.start, r.end]),
          },
        ])
      )[0]!.map((row) => JSON.parse(row.payload) as AnalyticsPeriodCounts),
  },
  range,
);
if (!dashboard.current.some((s) => s.coveredDays)) throw new Error("ANALYTICS_SOURCE_NOT_READY");
// Store evidence only. No external AI calls or content write capability.
const payload = JSON.stringify({
  range,
  previousRange: dashboard.previousRange,
  current: dashboard.current,
  previous: dashboard.previous,
  experience: dashboard.experience,
  adUnits: dashboard.breakdowns.adUnits,
  ai: { enabled: false, reason: "集計の本番検証と外部AI設定が完了していません" },
});
await d1([
  {
    sql: "INSERT INTO analytics_reports(period,start,end,generated_at,payload) VALUES(?,?,?,?,?) ON CONFLICT(period,start,end) DO UPDATE SET generated_at=excluded.generated_at,payload=excluded.payload",
    params: [period, start, end, new Date().toISOString(), payload],
  },
]);
process.stdout.write(`${period}: ${start}..${end} report saved\n`);
