WITH prepared AS (
  SELECT data_date AS date,clicks,impressions,sum_position AS positionSum,
    CASE WHEN NET.HOST(url) IN ('tomokichidiary.com','www.tomokichidiary.com') THEN
      COALESCE(NULLIF(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(url,r'^https?://[^/]+',''),r'[?#].*$',''),r'/+$',''),''),'/') ELSE NULL END AS path,
    IF(NOT COALESCE(is_anonymized_query,TRUE) AND query IS NOT NULL AND query!='',query,NULL) AS query
  FROM `tomokichidiary-analytics.searchconsole.searchdata_url_impression`
  WHERE data_date BETWEEN DATE(@start) AND DATE(@end) AND site_url=@property
), expanded AS (
  SELECT date,clicks,impressions,positionSum,path,d.grain,d.key
  FROM prepared CROSS JOIN UNNEST([STRUCT('page' AS grain,path AS key),STRUCT('query',query)]) d
  WHERE path IS NOT NULL AND d.key IS NOT NULL
)
SELECT CAST(date AS STRING) AS date,grain,key,path,SUM(clicks) AS clicks,SUM(impressions) AS impressions,SUM(positionSum) AS positionSum
FROM expanded GROUP BY date,grain,key,path ORDER BY date,grain,key,path
