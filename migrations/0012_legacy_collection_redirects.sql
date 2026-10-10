-- Earlier seeds retained /collections/* as well as the current /trips/*
-- canonical route for the same journey. Preserve the old URL as a 301.
UPDATE routes AS legacy
SET target_type = 'redirect',
    target_id = NULL,
    is_canonical = 0,
    redirect_to = (
      SELECT current.path FROM routes AS current
      WHERE current.target_type = 'journey'
        AND current.target_id = legacy.target_id
        AND current.locale = legacy.locale
        AND current.is_canonical = 1
        AND current.path LIKE '/trips/%'
    ),
    redirect_status = 301
WHERE legacy.target_type = 'journey'
  AND legacy.is_canonical = 1
  AND legacy.path LIKE '/collections/%'
  AND EXISTS (
    SELECT 1 FROM routes AS current
    WHERE current.target_type = 'journey'
      AND current.target_id = legacy.target_id
      AND current.locale = legacy.locale
      AND current.is_canonical = 1
      AND current.path LIKE '/trips/%'
  );
