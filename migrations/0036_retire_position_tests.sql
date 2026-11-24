-- Keep past assignments and results available in analytics. The web release
-- starts the site-wide anchor comparison from already published revisions.
UPDATE ad_experiments
SET status = 'stopped',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    payload = json_set(payload,
      '$.status', 'stopped',
      '$.stoppedAt', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      '$.updatedAt', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
WHERE status = 'running';
