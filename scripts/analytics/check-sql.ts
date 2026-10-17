/** Optional live BigQuery dialect test using synthetic data only; never reads native exports. */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const query = (sql: string, parameters: { end?: string; windows?: string } = {}) => {
  const result = execFileSync(
    "bq",
    [
      "--project_id=tomokichidiary-analytics",
      "query",
      "--use_legacy_sql=false",
      "--maximum_bytes_billed=100000000",
      "--format=json",
      "--quiet",
      "--parameter=start:STRING:2026-10-01",
      `--parameter=end:STRING:${parameters.end ?? "2026-10-01"}`,
      ...(parameters.windows ? [`--parameter=windows:STRING:${parameters.windows}`] : []),
      "--parameter=property:STRING:https://tomokichidiary.com/",
    ],
    { input: sql, encoding: "utf8", maxBuffer: 8 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] },
  );
  return JSON.parse(result.slice(result.indexOf("["))) as Record<string, string | null>[];
};
const read = (name: string) => readFileSync(new URL(`./sql/${name}.sql`, import.meta.url), "utf8");
const ga4 = read("ga4")
  .replace(
    "WITH events AS (",
    `WITH fixture AS (
  SELECT '20261001' AS _TABLE_SUFFIX,'20261001' AS event_date,
    r.event_name,r.user_pseudo_id,TRUE AS is_active_user,
    [STRUCT('ga_session_id' AS key,STRUCT(CAST(NULL AS STRING) AS string_value,r.session_id AS int_value) AS value),
     STRUCT('page_location',STRUCT('https://tomokichidiary.com/posts/example?utm=a#b',CAST(NULL AS INT64))),
     STRUCT('engagement_time_msec',STRUCT(CAST(NULL AS STRING),r.engagement_ms)),
     STRUCT('session_engaged',STRUCT('1',CAST(NULL AS INT64)))] AS event_params,
    STRUCT('desktop' AS category) AS device,STRUCT('fixture' AS source,'test' AS medium) AS traffic_source
  FROM UNNEST([
    STRUCT('session_start' AS event_name,'1' AS user_pseudo_id,23 AS session_id,0 AS engagement_ms),
    STRUCT('page_view','1',23,100),STRUCT('page_view','12',3,200),STRUCT('page_view',CAST(NULL AS STRING),CAST(NULL AS INT64),0)
  ]) r
), events AS (`,
  )
  .replace("`tomokichidiary-analytics.analytics_535794382.events_*`", "fixture");
const site = query(ga4).find((r) => r["grain"] === "site")!;
assert.equal(Number(site["pageViews"]), 3);
assert.equal(Number(site["users"]), 2);
assert.equal(Number(site["sessions"]), 2);
assert.equal(Number(site["engagedSessions"]), 2);
assert.equal(Number(site["engagementMs"]), 300);
const gsc = read("gsc_url")
  .replace(
    "WITH prepared AS (",
    `WITH fixture AS (
  SELECT DATE('2026-10-01') AS data_date,'https://tomokichidiary.com/' AS site_url,
    'https://tomokichidiary.com/posts/example/?utm=a#b' AS url,r.query,r.is_anonymized_query,r.clicks,r.impressions,r.sum_position
  FROM UNNEST([
    STRUCT('123' AS query,FALSE AS is_anonymized_query,1 AS clicks,10 AS impressions,0 AS sum_position),
    STRUCT('123',FALSE,9,90,900),STRUCT('',TRUE,1,10,5)
  ]) r
), prepared AS (`,
  )
  .replace("`tomokichidiary-analytics.searchconsole.searchdata_url_impression`", "fixture");
const rows = query(gsc);
const page = rows.find((r) => r["grain"] === "page")!;
const term = rows.find((r) => r["grain"] === "query")!;
assert.equal(Number(page["clicks"]), 11);
assert.equal(Number(page["impressions"]), 110);
assert.equal(Number(page["positionSum"]), 905);
assert.equal(page["path"], "/posts/example");
assert.equal(rows.filter((r) => r["grain"] === "query").length, 1);
assert.equal(term["key"], "123");
assert.equal(Number(term["positionSum"]) / Number(term["impressions"]) + 1, 10);

let fixture = ga4.slice(0, ga4.indexOf("), events AS (") + 1);
fixture = fixture
  .replace(
    "'20261001' AS _TABLE_SUFFIX,'20261001' AS event_date",
    "fixture_date AS _TABLE_SUFFIX,fixture_date AS event_date",
  )
  .replace("  ]) r\n)", "  ]) r CROSS JOIN UNNEST(['20261001','20261002']) fixture_date\n)");
const periodSql = read("ga4_periods")
  .replace(
    "WITH ranges AS (",
    `${fixture}, fixture_tables AS (SELECT 'events_20261001' AS table_name UNION ALL SELECT 'events_20261002'), ranges AS (`,
  )
  .replace(
    "`tomokichidiary-analytics.analytics_535794382.INFORMATION_SCHEMA.TABLES`",
    "fixture_tables",
  )
  .replace("`tomokichidiary-analytics.analytics_535794382.events_*`", "fixture");
const exact = query(periodSql, {
  end: "2026-10-02",
  windows: JSON.stringify([{ start: "2026-10-01", end: "2026-10-02" }]),
})[0]!;
assert.equal(Number(exact["users"]), 2);
assert.equal(Number(exact["sessions"]), 2);
assert.equal(Number(exact["coveredDays"]), 2);
process.stdout.write(
  "BigQuery synthetic SQL checks passed: session identity/missing IDs/period deduplication, GSC incremental keys/anonymity/URL/weighted position\n",
);
const experienceSql = read("ga4_experience")
  .replace(
    "WITH events AS (",
    `WITH fixture AS (
  SELECT '20261001' AS _TABLE_SUFFIX, '20261001' AS event_date, 'diary_measurement' AS event_name,
    STRUCT('mobile' AS category) AS device,
    [STRUCT('page_location' AS key,STRUCT(r.url AS string_value, CAST(NULL AS INT64) AS int_value, CAST(NULL AS FLOAT64) AS double_value) AS value),
     STRUCT('measurement_version',STRUCT(r.version,CAST(NULL AS INT64),CAST(NULL AS FLOAT64))),
     STRUCT('layout_version',STRUCT('article-end-v1',CAST(NULL AS INT64),CAST(NULL AS FLOAT64))),
     STRUCT('measurement',STRUCT(r.measurement,CAST(NULL AS INT64),CAST(NULL AS FLOAT64))),
     STRUCT('placement',STRUCT('none',CAST(NULL AS INT64),CAST(NULL AS FLOAT64))),
     STRUCT('vital',STRUCT(r.vital,CAST(NULL AS INT64),CAST(NULL AS FLOAT64))),
     STRUCT('value',STRUCT(CAST(NULL AS STRING),CAST(NULL AS INT64),r.number))] AS event_params
  FROM UNNEST([
    STRUCT('https://tomokichidiary.com/posts/a?private=omit#omit' AS url,'reader-v1' AS version,'article_view' AS measurement,'none' AS vital,1.0 AS number),
    STRUCT('https://tomokichidiary.com/posts/a','reader-v1','web_vital','LCP',2500.0),
    STRUCT('https://tomokichidiary.com/posts/a','reader-v1','web_vital','LCP',4000.0),
    STRUCT('https://tomokichidiary.com/posts/a','reader-v1','web_vital','LCP',4001.0),
    STRUCT('https://guide.tomokichidiary.com/posts/a','reader-v1','article_view','none',1.0),
    STRUCT('https://tomokichidiary.com/posts/a','unknown','article_view','none',1.0),
    STRUCT('https://tomokichidiary.com/posts/a','reader-v1','arbitrary_text','none',1.0),
    STRUCT('https://tomokichidiary.com/posts/a','reader-v1','visible_time','none',-1.0)
  ]) r
), events AS (`,
  )
  .replace("`tomokichidiary-analytics.analytics_535794382.events_*`", "fixture");
const experienceRows = query(experienceSql);
assert.equal(experienceRows.length, 2);
assert.ok(experienceRows.every((r) => r["path"] === "/posts/a" && r["grain"] === "experience"));
const measuredViews = experienceRows.find(
  (r) => JSON.parse(r["key"]!).measurement === "article_view",
)!;
assert.equal(Number(measuredViews["observations"]), 1);
const vital = experienceRows.find((r) => JSON.parse(r["key"]!).measurement === "web_vital")!;
assert.equal(Number(vital["vitalGood"]), 1);
assert.equal(Number(vital["vitalNeedsImprovement"]), 1);
assert.equal(Number(vital["vitalPoor"]), 1);
process.stdout.write(
  "BigQuery synthetic experience checks passed: privacy/hostname/allowlist/vital boundaries\n",
);

// Same bounded synthetic relation, now exercising the new layout and experiment allowlist.
const experimentSql = experienceSql
  .replaceAll(
    "https://tomokichidiary.com/posts/a",
    "https://tomokichidiary.com/posts/shanghai-chagee-menu",
  )
  .replace(
    "STRUCT('layout_version',STRUCT('article-end-v1'",
    "STRUCT('layout_version',STRUCT('article-placement-v2'",
  )
  .replace(
    "STRUCT('measurement',STRUCT(r.measurement",
    "STRUCT('experiment_id',STRUCT('chagee-placement-v1',CAST(NULL AS INT64),CAST(NULL AS FLOAT64))),\n     STRUCT('variant_id',STRUCT('B',CAST(NULL AS INT64),CAST(NULL AS FLOAT64))),\n     STRUCT('placement_key',STRUCT('answer-end',CAST(NULL AS INT64),CAST(NULL AS FLOAT64))),\n     STRUCT('measurement',STRUCT(r.measurement",
  );
const experimentRows = query(experimentSql);
assert.equal(experimentRows.length, 2);
assert.ok(
  experimentRows.every(
    (r) =>
      JSON.parse(r["key"]!).variant === "B" &&
      JSON.parse(r["key"]!).experimentId === "chagee-placement-v1",
  ),
);
assert.equal(
  query(
    experimentSql.replaceAll(
      "STRUCT('experiment_id',STRUCT('chagee-placement-v1'",
      "STRUCT('experiment_id',STRUCT('arbitrary-private-text'",
    ),
  ).length,
  0,
);
process.stdout.write(
  "BigQuery synthetic experiment checks passed: separate layout/variant and unknown experiment rejection\n",
);
