/** Read-only reconciliation. Results stay private; differences require human interpretation. */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import type { AnalyticsDay } from "@tomokichi/application";
import { addMetrics } from "@tomokichi/application";
const legacyPath = process.argv[2];
if (!legacyPath) throw new Error("Usage: compare-legacy.ts /path/to/legacy/snapshot.json");
const legacy = JSON.parse(readFileSync(legacyPath, "utf8")) as {
  generatedAt: string;
  ga4: { daily: { date: string; pageViews: number; users: number; sessions: number }[] };
  gsc: { daily: { date: string; clicks: number; impressions: number; position: number | null }[] };
};
const ga4 = JSON.parse(readFileSync(".data/analytics/ga4.json", "utf8")) as AnalyticsDay[];
const gsc = JSON.parse(readFileSync(".data/analytics/gsc_url.json", "utf8")) as AnalyticsDay[];
const ga4Rows = ga4.flatMap((day) => {
  const old = legacy.ga4.daily.find((r) => String(r.date) === day.date);
  const metrics = day.rows.find((r) => r.grain === "site")?.metrics;
  return old && metrics
    ? [
        {
          date: day.date,
          old,
          new: metrics,
          deltaPageViews: (metrics["pageViews"] ?? 0) - old.pageViews,
          deltaUsers: (metrics["users"] ?? 0) - old.users,
          deltaSessions: (metrics["sessions"] ?? 0) - old.sessions,
        },
      ]
    : [];
});
const gscRows = gsc.flatMap((day) => {
  const old = legacy.gsc.daily.find((r) => String(r.date) === day.date);
  const metrics = addMetrics(day.rows.filter((r) => r.grain === "page"));
  return old
    ? [
        {
          date: day.date,
          old,
          new: metrics,
          deltaClicks: (metrics["clicks"] ?? 0) - old.clicks,
          deltaImpressions: (metrics["impressions"] ?? 0) - old.impressions,
        },
      ]
    : [];
});
mkdirSync(".data/analytics", { recursive: true });
writeFileSync(
  ".data/analytics/legacy-comparison.json",
  JSON.stringify(
    {
      legacyGeneratedAt: legacy.generatedAt,
      ga4: ga4Rows,
      gsc: gscRows,
      notes: [
        "GA4 hostname filter and session definition differ",
        "GSC compares URL grain only; position may differ after rounding",
        "No migration approval is implied by this report",
      ],
    },
    null,
    2,
  ),
);
process.stdout.write(
  `Compared ${ga4Rows.length} GA4 and ${gscRows.length} GSC shared dates. Private report: .data/analytics/legacy-comparison.json\n`,
);
