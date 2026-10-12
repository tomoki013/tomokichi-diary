import { dateRange, shiftDate } from "@tomokichi/application";
import type {
  AnalyticsDay,
  AnalyticsSource,
  AnalyticsStatus,
  AnalyticsStore,
  DateRange,
} from "@tomokichi/application";
import type { SqlDatabase } from "./sql.js";

export function createAnalyticsStore(db: SqlDatabase): AnalyticsStore {
  return {
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
