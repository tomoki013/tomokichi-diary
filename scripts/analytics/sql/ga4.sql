-- Daily tables only; suffix range is constant/parameterized for pruning.
WITH events AS (
  SELECT PARSE_DATE('%Y%m%d',event_date) AS date, event_name, user_pseudo_id, is_active_user,
    (SELECT value.int_value FROM UNNEST(event_params) WHERE key='ga_session_id') AS session_id,
    COALESCE((SELECT value.int_value FROM UNNEST(event_params) WHERE key='engagement_time_msec'),0) AS engagement_ms,
    (SELECT COALESCE(value.string_value,CAST(value.int_value AS STRING)) FROM UNNEST(event_params) WHERE key='session_engaged') AS engaged,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key='page_location') AS url,
    device.category AS device, traffic_source.source AS first_source, traffic_source.medium AS first_medium
  FROM `tomokichidiary-analytics.analytics_535794382.events_*`
  WHERE _TABLE_SUFFIX BETWEEN REPLACE(@start,'-','') AND REPLACE(@end,'-','')
    AND REGEXP_CONTAINS(_TABLE_SUFFIX,r'^\d{8}$')
), prepared AS (
  SELECT *, CASE WHEN NET.HOST(url) IN ('tomokichidiary.com','www.tomokichidiary.com')
    THEN COALESCE(NULLIF(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(url,r'^https?://[^/]+',''),r'[?#].*$',''),r'/+$',''),''),'/')
    ELSE NULL END AS path,
    IF(user_pseudo_id IS NOT NULL AND session_id IS NOT NULL,TO_JSON_STRING(STRUCT(user_pseudo_id,session_id)),NULL) AS session_key
  FROM events
  WHERE NET.HOST(url) IN ('tomokichidiary.com','www.tomokichidiary.com')
), expanded AS (
  SELECT date,event_name,user_pseudo_id,is_active_user,session_key,engagement_ms,engaged,d.grain,d.key
  FROM prepared CROSS JOIN UNNEST([
    STRUCT('site' AS grain,'' AS key), STRUCT('page',path), STRUCT('device',COALESCE(device,'(unknown)')),
    STRUCT('source',CONCAT(COALESCE(first_source,'(unknown)'),' / ',COALESCE(first_medium,'(unknown)'))),
    STRUCT('event',event_name)
  ]) AS d
  WHERE d.key IS NOT NULL
)
SELECT CAST(date AS STRING) AS date,grain,key,IF(grain='page',key,NULL) AS path,
  COUNTIF(event_name='page_view') AS pageViews, COUNT(DISTINCT user_pseudo_id) AS users,
  COUNT(DISTINCT IF(is_active_user,user_pseudo_id,NULL)) AS activeUsers,
  COUNT(DISTINCT session_key) AS sessions,COUNT(DISTINCT IF(engaged='1',session_key,NULL)) AS engagedSessions,
  SUM(engagement_ms) AS engagementMs,COUNT(*) AS eventCount
FROM expanded GROUP BY date,grain,key,path ORDER BY date,grain,key
