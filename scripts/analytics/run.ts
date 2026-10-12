import { readFileSync } from "node:fs";
import { dateRange, shiftDate, type DateRange } from "@tomokichi/application";
import type { Route } from "@tomokichi/domain";
import { accessToken, BigQuery, SQL_NAMES } from "./bigquery.js";
import { d1 } from "./cloudflare.js";
import { collectSource, COLLECT_SOURCES } from "./collect.js";

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
const range: DateRange = dateRange(start || shiftDate(today, -7), end || shiftDate(today, -1), 31);
const dry = args.includes("--dry-run");
const persist = args.includes("--persist");
if (persist && process.env["ANALYTICS_ENABLED"] !== "1") throw new Error("ANALYTICS_NOT_ENABLED");
const bq = new BigQuery(accessToken());
if (dry) {
  for (const name of SQL_NAMES)
    await bq.query(
      name,
      range,
      true,
      name === "gsc_available" ? { namespace: "searchdata_url_impression" } : {},
    );
} else {
  let routes: Route[];
  if (persist) {
    const [rows] = await d1<{
      id: string;
      path: string;
      locale: string;
      target_type: string;
      target_id: string | null;
      is_canonical: number;
      redirect_to: string | null;
      redirect_status: number | null;
      is_legacy: number;
      noindex: number;
    }>([{ sql: "SELECT * FROM routes" }]);
    routes = rows!.map((r) => ({
      id: r.id,
      path: r.path,
      locale: r.locale,
      targetType: r.target_type,
      targetId: r.target_id,
      isCanonical: Boolean(r.is_canonical),
      redirectTo: r.redirect_to,
      redirectStatus: r.redirect_status,
      isLegacy: Boolean(r.is_legacy),
      noindex: Boolean(r.noindex),
    })) as Route[];
  } else {
    routes = JSON.parse(readFileSync("export/routes.json", "utf8")) as Route[];
  }
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
  if (errors.length) throw new Error(errors.join("; "));
}
