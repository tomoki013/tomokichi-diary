WITH expanded AS (
  SELECT data_date AS date, clicks,impressions,sum_top_position AS positionSum,d.grain,d.key
  FROM `tomokichidiary-analytics.searchconsole.searchdata_site_impression`
  CROSS JOIN UNNEST([STRUCT('site' AS grain,'' AS key),STRUCT('device',device),STRUCT('country',country),STRUCT('search_type',search_type)]) d
  WHERE data_date BETWEEN DATE(@start) AND DATE(@end)
    AND site_url=@property AND d.key IS NOT NULL
)
SELECT CAST(date AS STRING) AS date,grain,key,CAST(NULL AS STRING) AS path,
  SUM(clicks) AS clicks,SUM(impressions) AS impressions,SUM(positionSum) AS positionSum
FROM expanded GROUP BY date,grain,key ORDER BY date,grain,key
