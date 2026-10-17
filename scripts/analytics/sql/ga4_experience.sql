-- Bounded native export read. Only allowlisted anonymous measurements leave BigQuery.
WITH events AS (
  SELECT PARSE_DATE('%Y%m%d',event_date) AS date, device.category AS device,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key='page_location') AS url,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key='measurement_version') AS version,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key='layout_version') AS layout,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key='experiment_id') AS experimentId,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key='variant_id') AS variant,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key='placement_key') AS placementKey,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key='measurement') AS measurement,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key='placement') AS placement,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key='vital') AS vital,
    (SELECT COALESCE(value.double_value,CAST(value.int_value AS FLOAT64)) FROM UNNEST(event_params) WHERE key='value') AS value
  FROM `tomokichidiary-analytics.analytics_535794382.events_*`
  WHERE _TABLE_SUFFIX BETWEEN REPLACE(@start,'-','') AND REPLACE(@end,'-','')
    AND REGEXP_CONTAINS(_TABLE_SUFFIX,r'^\d{8}$') AND event_name='diary_measurement'
), prepared AS (
  SELECT *, COALESCE(NULLIF(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(url,r'^https?://[^/]+',''),r'[?#].*$',''),r'/+$',''),''),'/') AS path,
    CASE vital WHEN 'CLS' THEN 0.1 WHEN 'LCP' THEN 2500 WHEN 'INP' THEN 200 END AS good,
    CASE vital WHEN 'CLS' THEN 0.25 WHEN 'LCP' THEN 4000 WHEN 'INP' THEN 500 END AS needs
  FROM events
  WHERE NET.HOST(url) IN ('tomokichidiary.com','www.tomokichidiary.com')
    AND version='reader-v1' AND (layout='article-end-v1' AND measurement!='experiment_assignment' OR (layout='article-placement-v2' AND LENGTH(placementKey)<=64 AND REGEXP_CONTAINS(placementKey,r'^[a-z0-9]+(?:-[a-z0-9]+)*$') AND ((experimentId='none' AND variant='none' AND measurement!='experiment_assignment') OR (variant IN ('A','B') AND ((experimentId='chagee-placement-v1' AND REGEXP_REPLACE(REGEXP_REPLACE(url,r'^https?://[^/]+',''),r'[?#].*$','')='/posts/shanghai-chagee-menu') OR (REGEXP_CONTAINS(experimentId,r'^placement-v1-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$') AND REGEXP_CONTAINS(REGEXP_REPLACE(url,r'^https?://[^/]+',''),r'^/posts/[a-z0-9_-]+(?:[?#].*)?$')))))))
    AND device IN ('desktop','mobile','tablet')
    AND measurement IN ('experiment_assignment','article_view','body_25','body_50','body_75','body_90','body_end','candidate_reach','visible_time','next_article','share_action','like_action','ad_eligible','ad_request','ad_filled','ad_unfilled','ad_script_error','ad_viewable_proxy','web_vital')
    AND ((measurement='candidate_reach' AND placement IN ('candidate_mid_35','candidate_mid_65') AND vital='none' AND value=1)
      OR (STARTS_WITH(measurement,'ad_') AND placement IN ('article_end','body_slot') AND vital='none' AND value=1)
      OR (measurement='web_vital' AND placement='none' AND vital IN ('CLS','LCP','INP') AND value BETWEEN 0 AND IF(vital='CLS',100,600000))
      OR (measurement='visible_time' AND placement='none' AND vital='none' AND value BETWEEN 0 AND 1800000)
      OR (measurement IN ('experiment_assignment','article_view','body_25','body_50','body_75','body_90','body_end','next_article','share_action','like_action') AND placement='none' AND vital='none' AND value=1))
)
SELECT CAST(date AS STRING) AS date, 'experience' AS grain,
  TO_JSON_STRING(STRUCT(layout,device,measurement,placement,vital,experimentId,variant,placementKey)) AS key, path,
  COUNT(*) AS observations, SUM(value) AS valueSum,
  COUNTIF(measurement='web_vital' AND value<=good) AS vitalGood,
  COUNTIF(measurement='web_vital' AND value>good AND value<=needs) AS vitalNeedsImprovement,
  COUNTIF(measurement='web_vital' AND value>needs) AS vitalPoor
FROM prepared GROUP BY date,key,path ORDER BY date,key,path
