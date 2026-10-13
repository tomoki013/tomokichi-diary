SELECT SUBSTR(table_name,8,4)||'-'||SUBSTR(table_name,12,2)||'-'||SUBSTR(table_name,14,2) AS date
FROM `tomokichidiary-analytics.analytics_535794382.INFORMATION_SCHEMA.TABLES`
WHERE table_name BETWEEN 'events_'||REPLACE(@start,'-','') AND 'events_'||REPLACE(@end,'-','') AND REGEXP_CONTAINS(table_name,r'^events_\d{8}$')
