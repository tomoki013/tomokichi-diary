SELECT CAST(data_date AS STRING) AS date
FROM `tomokichidiary-analytics.searchconsole.ExportLog`
WHERE data_date BETWEEN DATE(@start) AND DATE(@end) AND LOWER(namespace)=@namespace
GROUP BY data_date
