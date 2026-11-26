import { analyticsView, dateRange, shiftDate } from "@tomokichi/application";
import {
  analyticsAffiliateHosts,
  analyticsArticleLabels,
  createAnalyticsStore,
} from "@tomokichi/infra-d1";
import { d1, restDatabase } from "./cloudflare.js";
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
// The daily collection saves each period once, after its first run on or after
// the period ends, so a late or missed schedule still saves it, in order.
if (process.argv.includes("--if-missing")) {
  const [saved] = await d1([
    {
      sql: "SELECT 1 FROM analytics_reports WHERE period=? AND start=? AND end=?",
      params: [period, start, end],
    },
  ]);
  if (saved!.length) {
    process.stdout.write(`${period}: ${start}..${end} already saved\n`);
    process.exit(0);
  }
}
// The same store, labels and view as the admin and ChatGPT, over the REST API.
const db = restDatabase();
const view = await analyticsView(createAnalyticsStore(db), range, undefined, {
  labels: (ids) => analyticsArticleLabels(db, ids),
  affiliateHosts: () => analyticsAffiliateHosts(db),
  limit: 100,
});
if (!view.sources.some((s) => s.coveredDays)) throw new Error("ANALYTICS_SOURCE_NOT_READY");
// Store evidence only. No external AI calls or content write capability.
const payload = JSON.stringify({ version: 2, ...view });
await d1([
  {
    sql: "INSERT INTO analytics_reports(period,start,end,generated_at,payload) VALUES(?,?,?,?,?) ON CONFLICT(period,start,end) DO UPDATE SET generated_at=excluded.generated_at,payload=excluded.payload",
    params: [period, start, end, new Date().toISOString(), payload],
  },
]);
process.stdout.write(`${period}: ${start}..${end} report saved\n`);
