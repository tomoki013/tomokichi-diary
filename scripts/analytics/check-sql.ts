/** Optional live BigQuery dialect test using synthetic data only; never reads native exports. */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const query = (sql: string) => {
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
      "--parameter=end:STRING:2026-10-01",
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
process.stdout.write(
  "BigQuery synthetic SQL checks passed: session identity/missing IDs, GSC incremental keys/anonymity/URL/weighted position\n",
);
