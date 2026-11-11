-- Where each visit came from and where it landed. One row set per session,
-- dated by the session's first day: the scan starts one day before @start so a
-- visit that runs past midnight is counted once, which makes entrances additive
-- across days. Only a referrer host, utm source/medium and new/returning leave
-- BigQuery; no identifier or full referrer URL does.
WITH events AS (
  SELECT event_date, event_timestamp, event_name, user_pseudo_id,
    (SELECT value.int_value FROM UNNEST(event_params) WHERE key='ga_session_id') AS session_id,
    (SELECT value.int_value FROM UNNEST(event_params) WHERE key='ga_session_number') AS session_number,
    (SELECT COALESCE(value.string_value,CAST(value.int_value AS STRING)) FROM UNNEST(event_params) WHERE key='session_engaged') AS engaged,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key='page_location') AS url,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key='page_referrer') AS referrer
  FROM `tomokichidiary-analytics.analytics_535794382.events_*`
  WHERE _TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d',DATE_SUB(DATE(@start),INTERVAL 1 DAY)) AND REPLACE(@end,'-','')
    AND REGEXP_CONTAINS(_TABLE_SUFFIX,r'^\d{8}$')
), sessions AS (
  SELECT user_pseudo_id, session_id, MIN(event_date) AS first_date,
    ARRAY_AGG(STRUCT(url,referrer) ORDER BY event_timestamp, IF(event_name='page_view',0,1) LIMIT 1)[OFFSET(0)] AS landing,
    MAX(session_number) AS session_number, LOGICAL_OR(engaged='1') AS engaged,
    COUNTIF(event_name='page_view') AS page_views
  FROM events
  WHERE NET.HOST(url) IN ('tomokichidiary.com','www.tomokichidiary.com')
    AND user_pseudo_id IS NOT NULL AND session_id IS NOT NULL
  GROUP BY user_pseudo_id, session_id
), prepared AS (
  SELECT first_date, engaged, page_views,
    COALESCE(NULLIF(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(landing.url,r'^https?://[^/]+',''),r'[?#].*$',''),r'/+$',''),''),'/') AS path,
    LOWER(COALESCE(NET.HOST(landing.referrer),'')) AS referrer_host,
    LOWER(COALESCE(REGEXP_EXTRACT(landing.url,r'[?&]utm_source=([^&#]*)'),'')) AS utm_source,
    LOWER(COALESCE(REGEXP_EXTRACT(landing.url,r'[?&]utm_medium=([^&#]*)'),'')) AS utm_medium,
    CASE WHEN session_number=1 THEN 'new' WHEN session_number>1 THEN 'returning' ELSE 'unknown' END AS visitor
  FROM sessions
  WHERE first_date >= REPLACE(@start,'-','')
), keyed AS (
  SELECT first_date, engaged, page_views, path, visitor,
    IF(referrer_host='' OR REGEXP_CONTAINS(referrer_host,r'^[a-z0-9.-]{1,100}$'),referrer_host,'(other)') AS referrer,
    IF(utm_source='' OR REGEXP_CONTAINS(utm_source,r'^[a-z0-9._-]{1,40}$'),utm_source,'(other)') AS source,
    IF(utm_medium='' OR REGEXP_CONTAINS(utm_medium,r'^[a-z0-9._-]{1,40}$'),utm_medium,'(other)') AS medium
  FROM prepared
)
SELECT CAST(PARSE_DATE('%Y%m%d',first_date) AS STRING) AS date, 'entry' AS grain,
  TO_JSON_STRING(STRUCT(referrer,source,medium,visitor)) AS key, path,
  COUNT(*) AS entrances, COUNTIF(engaged) AS engagedEntrances,
  SUM(page_views) AS entryPageViews, COUNTIF(page_views<=1) AS singlePageEntrances
FROM keyed GROUP BY first_date,referrer,source,medium,visitor,path ORDER BY date,key,path
