import { readFileSync } from "node:fs";
import { dateRange, shiftDate, type AnalyticsDay } from "@tomokichi/application";
import { analyticsReplacement } from "@tomokichi/infra-d1";
import { fetchAdSense } from "./adsense.js";
import { affiliateDays, type AffiliateRecord } from "./affiliate.js";
import { d1 } from "./cloudflare.js";
import { recordFailure } from "./collect.js";
import type { Route } from "@tomokichi/domain";
const args = process.argv.slice(2);
const get = (name: string) => args[args.indexOf(`--${name}`) + 1];
const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
const range = dateRange(
  process.env["ANALYTICS_START"] || shiftDate(today, -7),
  process.env["ANALYTICS_END"] || shiftDate(today, -1),
  31,
);
const now = new Date().toISOString();
let days: AnalyticsDay[] | null;
const affiliate = args.includes("--affiliate");
const source = affiliate ? "affiliate" : "adsense";
try {
  if (affiliate) {
    const file = get("affiliate");
    if (!file || !file.startsWith(".data/analytics/"))
      throw new Error("ANALYTICS_AFFILIATE_PRIVATE_INPUT");
    days = affiliateDays(
      JSON.parse(readFileSync(file, "utf8")) as AffiliateRecord[],
      JSON.parse(readFileSync("export/routes.json", "utf8")) as Route[],
      now,
    );
    if (days.some((day) => day.date < range.start || day.date > range.end))
      throw new Error("ANALYTICS_INVALID_RANGE");
  } else days = await fetchAdSense(range);
  if (days === null) {
    process.stdout.write("AdSense disabled\n");
    process.exit(0);
  }
  if (!args.includes("--persist")) {
    process.stdout.write(`${source}: ${days.length} days validated (no write)\n`);
  } else {
    if (process.env["ANALYTICS_ENABLED"] !== "1") throw new Error("ANALYTICS_NOT_ENABLED");
    await d1(analyticsReplacement(source, range, days, now));
    if (!days.length) await recordFailure(source, "ANALYTICS_NO_REVENUE_DATA");
  }
} catch (error) {
  if (args.includes("--persist") && process.env["ANALYTICS_ENABLED"] === "1") {
    await d1([
      {
        sql: "INSERT INTO analytics_status(source,attempted_at) VALUES(?,?) ON CONFLICT(source) DO UPDATE SET attempted_at=excluded.attempted_at",
        params: [source, now],
      },
    ]);
    await recordFailure(source, "ANALYTICS_REVENUE_FAILED");
  }
  // oxlint-disable-next-line eslint/preserve-caught-error -- Import parse errors can contain private rewards.
  throw new Error(
    error instanceof Error && /^ANALYTICS_[A-Z_0-9]+$/.test(error.message)
      ? error.message
      : "ANALYTICS_REVENUE_FAILED",
  );
}
