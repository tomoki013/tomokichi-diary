-- The final day in Paris was split from an existing story. It belongs
-- between Versailles (Feb 16) and the flight to Barcelona (Feb 18).
-- Leave the published and draft revision pointers exactly as they are.
UPDATE articles
SET published_at = '2025-02-17T00:00:00.000Z',
    travel_start_date = COALESCE(travel_start_date, '2025-02-17')
WHERE id = '01a1d3a7-abed-7627-8019-97f5c8a3a9b1'
  AND slug = 'france4'
  AND published_at = '2026-11-14T03:35:51.171Z';
