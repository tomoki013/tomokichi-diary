import { mkdirSync, writeFileSync } from "node:fs";
import { assertAnalyticsDay } from "@tomokichi/contracts";
import {
  dates,
  resolveAnalyticsArticle,
  shiftDate,
  type AnalyticsDay,
  type AnalyticsRow,
  type AnalyticsSource,
  type DateRange,
} from "@tomokichi/application";
import type { Route } from "@tomokichi/domain";
import { analyticsReplacement } from "@tomokichi/infra-d1";
import { BigQuery, type SqlName } from "./bigquery.js";
import { d1 } from "./cloudflare.js";
export const COLLECT_SOURCES = ["ga4", "gsc_site", "gsc_url"] as const;
export function buildDays(
  source: AnalyticsSource,
  range: DateRange,
  available: string[],
  rows: Record<string, string | null>[],
  routes: readonly Route[],
  now: string,
): AnalyticsDay[] {
  const allowed = new Set(dates(range));
  const ready = [...new Set(available)].filter((date) => allowed.has(date)).toSorted();
  const result: AnalyticsDay[] = ready.map((date) => ({
    source,
    date,
    retrievedAt: now,
    provisional: date > shiftDate(now.slice(0, 10), -4),
    rows: [],
  }));
  const byDate = new Map(result.map((day) => [day.date, day]));
  for (const raw of rows) {
    const day = byDate.get(raw["date"] ?? "");
    if (!day) throw new Error("ANALYTICS_EXPORT_INCONSISTENT");
    const row: AnalyticsRow = {
      grain: raw["grain"] as AnalyticsRow["grain"],
      key: raw["key"] ?? "",
      path: raw["path"] ?? null,
      articleId: null,
      metrics: {},
    };
    if (row.path) {
      const resolved = resolveAnalyticsArticle(row.path, routes);
      row.articleId =
        resolved.articleId; /* keep observed path: merging distinct counts would be incorrect */
    }
    for (const [key, value] of Object.entries(raw))
      if (!["date", "grain", "key", "path"].includes(key))
        row.metrics[key] = value === null ? null : Number(value);
    day.rows.push(row);
  }
  for (const day of result) {
    if (source === "ga4" || source === "gsc_site") {
      if (!day.rows.some((r) => r.grain === "site"))
        day.rows.push({
          grain: "site",
          key: "",
          path: null,
          articleId: null,
          metrics:
            source === "ga4"
              ? {
                  pageViews: 0,
                  users: 0,
                  activeUsers: 0,
                  sessions: 0,
                  engagedSessions: 0,
                  engagementMs: 0,
                  eventCount: 0,
                }
              : { clicks: 0, impressions: 0, positionSum: 0 },
        });
    }
    assertAnalyticsDay(day);
  }
  return result;
}
export async function collectSource(
  bq: BigQuery,
  source: (typeof COLLECT_SOURCES)[number],
  range: DateRange,
  routes: readonly Route[],
  persist: boolean,
) {
  const now = new Date().toISOString();
  if (persist)
    await d1([
      {
        sql: "INSERT INTO analytics_status(source,attempted_at) VALUES(?,?) ON CONFLICT(source) DO UPDATE SET attempted_at=excluded.attempted_at",
        params: [source, now],
      },
    ]);
  try {
    const availability = source === "ga4" ? "ga4_available" : "gsc_available";
    const available = await bq.query(
      availability,
      range,
      false,
      source === "ga4"
        ? {}
        : {
            namespace:
              source === "gsc_site" ? "searchdata_site_impression" : "searchdata_url_impression",
          },
    );
    if (!available.length) throw new Error("ANALYTICS_SOURCE_NOT_READY");
    const rows = await bq.query(source as SqlName, range);
    if (source === "ga4") rows.push(...(await bq.query("ga4_experience", range)));
    if (source !== "ga4" && !rows.length) throw new Error("ANALYTICS_NO_GSC_ROWS");
    const days = buildDays(
      source,
      range,
      available.map((r) => r["date"]!),
      rows,
      routes,
      new Date().toISOString(),
    );
    if (persist) {
      await d1(analyticsReplacement(source, range, days, now));
      if (days.length < dates(range).length)
        await recordFailure(source, "ANALYTICS_INCOMPLETE_EXPORT");
    } else {
      mkdirSync(".data/analytics", { recursive: true });
      writeFileSync(`.data/analytics/${source}.json`, JSON.stringify(days));
    }
    process.stdout.write(
      `${source}: ${days.length}/${dates(range).length} exported days, ${rows.length} aggregate rows\n`,
    );
    return days;
  } catch (error) {
    const message =
      error instanceof Error && /^ANALYTICS_[A-Z_0-9]+$/.test(error.message)
        ? error.message
        : "ANALYTICS_COLLECTION_FAILED";
    if (persist) await recordFailure(source, message);
    // oxlint-disable-next-line eslint/preserve-caught-error -- Public Actions logs must not include upstream private payloads.
    throw new Error(message);
  }
}
export async function recordFailure(source: AnalyticsSource, code: string) {
  await d1([{ sql: "UPDATE analytics_status SET error=? WHERE source=?", params: [code, source] }]);
}
