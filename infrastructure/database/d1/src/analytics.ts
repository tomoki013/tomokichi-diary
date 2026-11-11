import { dateRange, factsOf, shiftDate, TREND_MAX_DAYS } from "@tomokichi/application";
import type {
  AnalyticsDay,
  AnalyticsPeriodCounts,
  AnalyticsSource,
  AnalyticsStatus,
  AnalyticsStore,
  DateRange,
  FactSeriesRow,
  FactTotalRow,
} from "@tomokichi/application";
import type { SqlDatabase } from "./sql.js";

const part = (column: string) => `SUM(CASE WHEN date BETWEEN ? AND ? THEN ${column} END)`;
const FACT_SUMS = `SUM(page_views) AS pageViews,SUM(entrances) AS entrances,SUM(engaged_entrances) AS engagedEntrances,
  SUM(new_entrances) AS newEntrances,SUM(clicks) AS clicks,SUM(impressions) AS impressions,
  SUM(position_sum) AS positionSum,SUM(earnings_jpy) AS earningsJPY`;

export function createAnalyticsStore(db: SqlDatabase): AnalyticsStore {
  return {
    factSeries: async (grain, range, bucket, keys) => {
      dateRange(range.start, range.end, TREND_MAX_DAYS);
      if (keys && !keys.length) return [];
      const start =
        bucket === "week" ? "date(date,'weekday 0','-6 days')" : "substr(date,1,7)||'-01'";
      return db
        .prepare(
          `SELECT source,key,${start} AS bucket,COUNT(*) AS days,${FACT_SUMS}
           FROM analytics_facts WHERE grain=? AND date BETWEEN ? AND ?
           ${keys ? `AND key IN (${keys.map(() => "?").join(",")})` : ""}
           GROUP BY source,key,bucket ORDER BY bucket`,
        )
        .bind(grain, range.start, range.end, ...(keys ?? []))
        .all<FactSeriesRow>();
    },
    factTotals: async (grain, range, earlier, recent) => {
      dateRange(range.start, range.end, TREND_MAX_DAYS);
      return db
        .prepare(
          `SELECT key,SUM(page_views) AS pageViews,SUM(clicks) AS clicks,SUM(entrances) AS entrances,
             ${part("page_views")} AS recentPageViews,${part("clicks")} AS recentClicks,
             ${part("page_views")} AS earlierPageViews,${part("clicks")} AS earlierClicks
           FROM analytics_facts WHERE grain=? AND date BETWEEN ? AND ? GROUP BY key`,
        )
        .bind(
          recent.start,
          recent.end,
          recent.start,
          recent.end,
          earlier.start,
          earlier.end,
          earlier.start,
          earlier.end,
          grain,
          range.start,
          range.end,
        )
        .all<FactTotalRow>();
    },
    readCounts: async (ranges) => {
      const rows = await db
        .prepare(
          `SELECT payload FROM analytics_period_counts WHERE ${ranges.map(() => "(start=? AND end=?)").join(" OR ")}`,
        )
        .bind(...ranges.flatMap((r) => [r.start, r.end]))
        .all<{ payload: string }>();
      return rows.map((row) => JSON.parse(row.payload) as AnalyticsPeriodCounts);
    },
    read: async (range) => {
      dateRange(range.start, range.end, 186);
      const days: AnalyticsDay[] = [];
      // Bound each D1 result to a week of summaries instead of returning
      // months of search-query rows in one oversized database response.
      for (let start = range.start; start <= range.end; start = shiftDate(start, 7)) {
        const end = shiftDate(start, 6) < range.end ? shiftDate(start, 6) : range.end;
        const rows = await db
          .prepare("SELECT payload FROM analytics_days WHERE date BETWEEN ? AND ? ORDER BY date")
          .bind(start, end)
          .all<{ payload: string }>();
        days.push(...rows.map((row) => JSON.parse(row.payload) as AnalyticsDay));
      }
      return days;
    },
    statuses: async () =>
      (
        await db.prepare("SELECT * FROM analytics_status").all<{
          source: AnalyticsSource;
          attempted_at: string | null;
          succeeded_at: string | null;
          latest_date: string | null;
          range_start: string | null;
          range_end: string | null;
          error: string | null;
        }>()
      ).map(
        (row) =>
          ({
            source: row.source,
            attemptedAt: row.attempted_at,
            succeededAt: row.succeeded_at,
            latestDate: row.latest_date,
            start: row.range_start,
            end: row.range_end,
            error: row.error,
          }) satisfies AnalyticsStatus,
      ),
  };
}
/** Shared parameterized statements for local SQLite and the D1 REST adapter. One atomic batch per source/range. */
export function analyticsReplacement(
  source: AnalyticsSource,
  range: DateRange,
  days: AnalyticsDay[],
  attemptedAt: string,
) {
  const latestDate =
    days
      .map((d) => d.date)
      .toSorted()
      .at(-1) ?? null;
  return [
    ...days.map((day) => ({
      sql: "DELETE FROM analytics_days WHERE source = ? AND date = ?",
      params: [source, day.date],
    })),
    ...days.map((day) => ({
      sql: "INSERT INTO analytics_days(source,date,payload) VALUES (?,?,?)",
      params: [source, day.date, JSON.stringify(day)],
    })),
    // The same day again as compact lines for the long-range trend.
    ...days.map((day) => ({
      sql: "DELETE FROM analytics_facts WHERE source = ? AND date = ?",
      params: [source, day.date],
    })),
    ...days.map((day) => ({
      sql: `INSERT INTO analytics_facts(date,source,grain,key,page_views,entrances,engaged_entrances,new_entrances,clicks,impressions,position_sum,earnings_jpy)
      SELECT ?,?,json_extract(value,'$.grain'),json_extract(value,'$.key'),json_extract(value,'$.pageViews'),json_extract(value,'$.entrances'),
        json_extract(value,'$.engagedEntrances'),json_extract(value,'$.newEntrances'),json_extract(value,'$.clicks'),json_extract(value,'$.impressions'),
        json_extract(value,'$.positionSum'),json_extract(value,'$.earningsJPY') FROM json_each(?)`,
      params: [day.date, source, JSON.stringify(factsOf(day))],
    })),
    {
      sql: `INSERT INTO analytics_status(source,attempted_at,succeeded_at,latest_date,range_start,range_end,error) VALUES(?,?,?,?,?,?,NULL)
      ON CONFLICT(source) DO UPDATE SET attempted_at=excluded.attempted_at,succeeded_at=excluded.succeeded_at,latest_date=(SELECT MAX(date) FROM analytics_days WHERE source=excluded.source),range_start=excluded.range_start,range_end=excluded.range_end,error=NULL`,
      params: [
        source,
        attemptedAt,
        days[0]?.retrievedAt ?? attemptedAt,
        latestDate,
        range.start,
        range.end,
      ],
    },
  ];
}
