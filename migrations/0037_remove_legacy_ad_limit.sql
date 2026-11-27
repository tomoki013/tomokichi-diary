-- Only remove the obsolete setting. Preserve revisions, placement state and timestamps.
UPDATE monetization_settings
SET payload = json_remove(payload, '$.maxAds')
WHERE json_type(payload, '$.maxAds') IS NOT NULL;

UPDATE article_monetization
SET payload = json_remove(payload, '$.maxAds')
WHERE json_type(payload, '$.maxAds') IS NOT NULL;
