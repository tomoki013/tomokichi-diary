WITH ranges AS (
 SELECT JSON_VALUE(item,'$.start') AS start,JSON_VALUE(item,'$.end') AS `end`
 FROM UNNEST(JSON_QUERY_ARRAY(@windows)) item
), available AS (
 SELECT SUBSTR(table_name,8,4)||'-'||SUBSTR(table_name,12,2)||'-'||SUBSTR(table_name,14,2) AS date
 FROM `tomokichidiary-analytics.analytics_535794382.INFORMATION_SCHEMA.TABLES`
 WHERE table_name BETWEEN 'events_'||REPLACE(@start,'-','') AND 'events_'||REPLACE(@end,'-','')
 AND REGEXP_CONTAINS(table_name,r'^events_\d{8}$')
), events AS (
 SELECT PARSE_DATE('%Y%m%d',event_date) AS date,user_pseudo_id,is_active_user,
   (SELECT value.int_value FROM UNNEST(event_params) WHERE key='ga_session_id') AS session_id,
   (SELECT COALESCE(value.string_value,CAST(value.int_value AS STRING)) FROM UNNEST(event_params) WHERE key='session_engaged') AS engaged
 FROM `tomokichidiary-analytics.analytics_535794382.events_*`
 WHERE _TABLE_SUFFIX BETWEEN REPLACE(@start,'-','') AND REPLACE(@end,'-','') AND REGEXP_CONTAINS(_TABLE_SUFFIX,r'^\d{8}$')
 AND NET.HOST((SELECT value.string_value FROM UNNEST(event_params) WHERE key='page_location')) IN ('tomokichidiary.com','www.tomokichidiary.com')
)
SELECT r.start,r.end,
 (SELECT COUNT(*) FROM available a WHERE a.date BETWEEN r.start AND r.end) AS coveredDays,
 COUNT(DISTINCT e.user_pseudo_id) AS users,
 COUNT(DISTINCT IF(e.is_active_user,e.user_pseudo_id,NULL)) AS activeUsers,
 COUNT(DISTINCT IF(e.user_pseudo_id IS NOT NULL AND e.session_id IS NOT NULL,TO_JSON_STRING(STRUCT(e.user_pseudo_id,e.session_id)),NULL)) AS sessions,
 COUNT(DISTINCT IF(e.user_pseudo_id IS NOT NULL AND e.session_id IS NOT NULL AND e.engaged='1',TO_JSON_STRING(STRUCT(e.user_pseudo_id,e.session_id)),NULL)) AS engagedSessions
FROM ranges r LEFT JOIN events e ON e.date BETWEEN DATE(r.start) AND DATE(r.end)
GROUP BY r.start,r.end ORDER BY r.start,r.end
