-- Daily tables only; suffix range is constant/parameterized for pruning.
WITH events AS (
  SELECT PARSE_DATE('%Y%m%d',event_date) AS date, event_name, user_pseudo_id, is_active_user,
    (SELECT value.int_value FROM UNNEST(event_params) WHERE key='ga_session_id') AS session_id,
    COALESCE((SELECT value.int_value FROM UNNEST(event_params) WHERE key='engagement_time_msec'),0) AS engagement_ms,
    (SELECT COALESCE(value.string_value,CAST(value.int_value AS STRING)) FROM UNNEST(event_params) WHERE key='session_engaged') AS engaged,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key='page_location') AS url,
    -- GA4's automatic outbound-link click carries the destination; no site event is added for it.
    IF(event_name='click',(SELECT value.string_value FROM UNNEST(event_params) WHERE key='link_url'),NULL) AS link_url,
    device.category AS device, traffic_source.source AS first_source, traffic_source.medium AS first_medium
  FROM `tomokichidiary-analytics.analytics_535794382.events_*`
  WHERE _TABLE_SUFFIX BETWEEN REPLACE(@start,'-','') AND REPLACE(@end,'-','')
    AND REGEXP_CONTAINS(_TABLE_SUFFIX,r'^\d{8}$')
), prepared AS (
  SELECT *, CASE WHEN NET.HOST(url) IN ('tomokichidiary.com','www.tomokichidiary.com')
    THEN COALESCE(NULLIF(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(url,r'^https?://[^/]+',''),r'[?#].*$',''),r'/+$',''),''),'/')
    ELSE NULL END AS path,
    IF(user_pseudo_id IS NOT NULL AND session_id IS NOT NULL,TO_JSON_STRING(STRUCT(user_pseudo_id,session_id)),NULL) AS session_key,
    -- Destination host only, never the full URL: affiliate links carry tracking ids.
    IF(NET.HOST(link_url) NOT IN ('tomokichidiary.com','www.tomokichidiary.com'),LOWER(NET.HOST(link_url)),NULL) AS outbound_host
  FROM events
  WHERE NET.HOST(url) IN ('tomokichidiary.com','www.tomokichidiary.com')
), expanded AS (
  SELECT date,event_name,user_pseudo_id,is_active_user,session_key,engagement_ms,engaged,outbound_host,d.grain,d.key,
    IF(d.grain='outbound',path,NULL) AS outbound_path
  FROM prepared CROSS JOIN UNNEST([
    STRUCT('site' AS grain,'' AS key), STRUCT('page',path), STRUCT('device',COALESCE(device,'(unknown)')),
    STRUCT('source',CONCAT(COALESCE(first_source,'(unknown)'),' / ',COALESCE(first_medium,'(unknown)'))),
    STRUCT('event',event_name),
    -- Clicks to another site, by the page clicked on and the destination host.
    STRUCT('outbound',outbound_host)
  ]) AS d
  WHERE d.key IS NOT NULL
)
SELECT CAST(date AS STRING) AS date,grain,key,CASE grain WHEN 'page' THEN key WHEN 'outbound' THEN outbound_path END AS path,
  COUNTIF(event_name='page_view') AS pageViews, COUNT(DISTINCT user_pseudo_id) AS users,
  COUNT(DISTINCT IF(is_active_user,user_pseudo_id,NULL)) AS activeUsers,
  COUNT(DISTINCT session_key) AS sessions,COUNT(DISTINCT IF(engaged='1',session_key,NULL)) AS engagedSessions,
  SUM(engagement_ms) AS engagementMs,COUNT(*) AS eventCount,
  -- On the site row only: present (0 or more) marks a day collected with outbound clicks.
  IF(grain='site',COUNTIF(outbound_host IS NOT NULL),NULL) AS outboundClicks
FROM expanded GROUP BY date,grain,key,path ORDER BY date,grain,key
