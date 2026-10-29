import { dateRange, shiftDate, type DateRange } from "@tomokichi/application";
import { accessToken, BigQuery, SQL_NAMES } from "./bigquery.js";
import { collectPeriodCounts } from "./periods.js";
import { loadRoutes } from "./cloudflare.js";
import { collectSource, COLLECT_SOURCES, recordFailure } from "./collect.js";

const args = process.argv.slice(2);
function option(name: string) {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? undefined : args[i + 1];
}
const start = option("start") ?? process.env["ANALYTICS_START"];
const end = option("end") ?? process.env["ANALYTICS_END"];
if (Boolean(start) !== Boolean(end)) throw new Error("ANALYTICS_INVALID_RANGE");
// Conservative target: yesterday in JST. Actual availability is checked independently.
const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
const countsOnly = args.includes("--period-only");
const range: DateRange = dateRange(
  start || shiftDate(today, -7),
  end || shiftDate(today, -1),
  countsOnly ? 93 : 31,
);
const dry = args.includes("--dry-run");
const persist = args.includes("--persist");
if (persist && process.env["ANALYTICS_ENABLED"] !== "1") throw new Error("ANALYTICS_NOT_ENABLED");
const bq = new BigQuery(accessToken());
if (countsOnly) {
  try {
    await collectPeriodCounts(bq, range, persist, dry);
  } catch {
    if (persist) await recordFailure("ga4", "ANALYTICS_COUNTS_FAILED");
    throw new Error("ANALYTICS_COUNTS_FAILED");
  }
} else if (dry) {
  for (const name of SQL_NAMES.filter((n) => n !== "ga4_periods"))
    await bq.query(
      name,
      range,
      true,
      name === "gsc_available" ? { namespace: "searchdata_url_impression" } : {},
    );
  await collectPeriodCounts(bq, range, false, true);
} else {
  const routes = await loadRoutes(persist);
  const errors: string[] = [];
  for (const source of COLLECT_SOURCES) {
    try {
      await collectSource(bq, source, range, routes, persist);
    } catch (error) {
      errors.push(
        `${source}: ${error instanceof Error ? error.message : "ANALYTICS_COLLECTION_FAILED"}`,
      );
    }
  }
  try {
    await collectPeriodCounts(bq, range, persist);
  } catch {
    if (persist) await recordFailure("ga4", "ANALYTICS_COUNTS_FAILED");
    errors.push("ga4 period counts: ANALYTICS_COLLECTION_FAILED");
  }
  if (errors.length) throw new Error(errors.join("; "));
}
