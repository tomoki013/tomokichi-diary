import { addMetrics, dateRange, factsOf, shiftDate, TREND_MAX_DAYS } from "@tomokichi/application";
import type {
  AnalyticsArticleLabel,
  AnalyticsDay,
  AnalyticsRow,
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

const metricRow = (
  path: string | null,
  key: string,
  articleId: string | null,
  clicks: number | null,
  impressions: number | null,
  positionSum: number | null,
): AnalyticsRow => {
  const row: AnalyticsRow = {
    grain: "query",
    key,
    path,
    articleId,
    metrics: { clicks, impressions, positionSum },
  };
  return { ...row, metrics: addMetrics([row]) };
};

/** Published title, canonical path, first publication and tag names, for naming and classifying articles. */
export async function analyticsArticleLabels(db: SqlDatabase, ids: readonly string[]) {
  const labels = new Map<string, AnalyticsArticleLabel>();
  if (!ids.length) return labels;
  const rows = await db
    .prepare(
      `SELECT a.id,a.published_at AS publishedAt,r.title,
         (SELECT path FROM routes WHERE target_type='article' AND target_id=a.id AND is_canonical=1 ORDER BY path LIMIT 1) AS path,
         (SELECT json_group_array(t.name) FROM publication_metadata m, json_each(m.metadata,'$.tags') j
            JOIN tags t ON t.id=json_extract(j.value,'$.tagId') WHERE m.revision_id=r.id) AS tags
       FROM articles a LEFT JOIN article_revisions r ON r.id=a.published_revision_id
       WHERE a.id IN (SELECT value FROM json_each(?))`,
    )
    .bind(JSON.stringify(ids))
    .all<{
      id: string;
      publishedAt: string | null;
      title: string | null;
      path: string | null;
      tags: string | null;
    }>();
  for (const row of rows)
    labels.set(row.id, {
      title: row.title,
      path: row.path,
      publishedAt: row.publishedAt,
      tags: row.tags ? (JSON.parse(row.tags) as string[]) : [],
    });
  return labels;
}
/** Hosts the affiliate offers link to (any status: an archived offer's clicks still count). Never the URLs. */
export async function analyticsAffiliateHosts(db: SqlDatabase) {
  const rows = await db
    .prepare(
      "SELECT json_extract(payload,'$.provider') AS provider,json_extract(payload,'$.url') AS url FROM affiliate_offers",
    )
    .all<{ provider: string | null; url: string | null }>();
  const hosts = new Map<string, string>();
  for (const row of rows) {
    if (!URL.canParse(row.url ?? "")) continue;
    const host = new URL(row.url!).hostname.toLowerCase();
    if (!hosts.has(host)) hosts.set(host, row.provider ?? host);
  }
  return [...hosts].map(([host, provider]) => ({ host, provider }));
}

export function createAnalyticsStore(db: SqlDatabase): AnalyticsStore {
  return {
    queryPage: async (current, previous, articleId, limit, offset) => {
      // Page URL × query on the server before transferring results to the Worker.
      // The total survives even an offset beyond the last row.
      const rows = await db
        .prepare(
          `WITH grouped AS (
        SELECT d.date >= ? AS recent, json_extract(j.value,'$.path') AS path,
          json_extract(j.value,'$.key') AS term, MIN(json_extract(j.value,'$.articleId')) AS articleId,
          SUM(json_extract(j.value,'$.metrics.clicks')) AS clicks,
          SUM(json_extract(j.value,'$.metrics.impressions')) AS impressions,
          SUM(json_extract(j.value,'$.metrics.positionSum')) AS positionSum
        FROM analytics_days d, json_each(d.payload,'$.rows') j
        WHERE d.source='gsc_url' AND d.date BETWEEN ? AND ? AND json_extract(j.value,'$.grain')='query'
          ${articleId ? "AND json_extract(j.value,'$.articleId')=?" : ""}
        GROUP BY recent,json_extract(j.value,'$.path'),term
      ), ranked AS (
        SELECT * FROM grouped WHERE recent=1 ORDER BY clicks DESC,path,term LIMIT ? OFFSET ?
      )
      SELECT t.total, r.path,r.term,r.articleId,r.clicks,r.impressions,r.positionSum,
        p.term AS previousTerm,p.articleId AS previousId,p.clicks AS previousClicks,p.impressions AS previousImpressions,p.positionSum AS previousPosition
      FROM (SELECT COUNT(*) AS total FROM grouped WHERE recent=1) t LEFT JOIN ranked r ON true
      LEFT JOIN grouped p ON p.recent=0 AND p.path IS r.path AND p.term=r.term
      ORDER BY r.clicks DESC,r.path,r.term`,
        )
        .bind(
          current.start,
          previous.start,
          current.end,
          ...(articleId ? [articleId] : []),
          limit,
          offset,
        )
        .all<{
          total: number;
          path: string | null;
          term: string | null;
          articleId: string | null;
          clicks: number | null;
          impressions: number | null;
          positionSum: number | null;
          previousTerm: string | null;
          previousId: string | null;
          previousClicks: number | null;
          previousImpressions: number | null;
          previousPosition: number | null;
        }>();
      const page: AnalyticsRow[] = [],
        matched: AnalyticsRow[] = [];
      for (const row of rows) {
        if (row.term !== null)
          page.push(
            metricRow(
              row.path,
              row.term,
              row.articleId,
              row.clicks,
              row.impressions,
              row.positionSum,
            ),
          );
        if (row.previousTerm !== null)
          matched.push(
            metricRow(
              row.path,
              row.previousTerm,
              row.previousId,
              row.previousClicks,
              row.previousImpressions,
              row.previousPosition,
            ),
          );
      }
      return { rows: page, previous: matched, total: rows[0]?.total ?? 0 };
    },
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
    read: async (range, grains) => {
      dateRange(range.start, range.end, 186);
      const days: AnalyticsDay[] = [];
      // Asked for some grains only: SQLite picks those rows out of each day,
      // so the Worker never parses the rest (search queries and reader
      // measurements are most of a day, and most reads do not need them).
      const select = grains
        ? `SELECT json_object('source',d.source,'date',d.date,'retrievedAt',json_extract(d.payload,'$.retrievedAt'),
             'provisional',json(CASE WHEN json_extract(d.payload,'$.provisional') THEN 'true' ELSE 'false' END),
             'rows',(SELECT json_group_array(json(j.value)) FROM json_each(d.payload,'$.rows') j
                     WHERE json_extract(j.value,'$.grain') IN (${grains.map(() => "?").join(",")}))) AS payload
           FROM analytics_days d WHERE d.date BETWEEN ? AND ? ORDER BY d.date`
        : "SELECT payload FROM analytics_days WHERE date BETWEEN ? AND ? ORDER BY date";
      // Bound each D1 result to a week of summaries instead of returning
      // months of search-query rows in one oversized database response.
      for (let start = range.start; start <= range.end; start = shiftDate(start, 7)) {
        const end = shiftDate(start, 6) < range.end ? shiftDate(start, 6) : range.end;
        const rows = await db
          .prepare(select)
          .bind(...(grains ?? []), start, end)
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
