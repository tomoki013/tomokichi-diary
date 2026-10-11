-- The current importer has used /collections/* since 2026-08-30.
-- Repair the reversed redirects introduced by 0012 without removing any URL.
UPDATE routes AS collection
SET target_type = 'journey',
    target_id = (
      SELECT trip.target_id FROM routes AS trip
      WHERE trip.path = collection.redirect_to AND trip.locale = collection.locale
        AND trip.target_type = 'journey' AND trip.is_canonical = 1
    ),
    is_canonical = 1, redirect_to = NULL, redirect_status = NULL
WHERE collection.path LIKE '/collections/%'
  AND collection.target_type = 'redirect'
  AND collection.redirect_to LIKE '/trips/%'
  AND EXISTS (
    SELECT 1 FROM routes AS trip
    WHERE trip.path = collection.redirect_to AND trip.locale = collection.locale
      AND trip.target_type = 'journey' AND trip.is_canonical = 1
  );

UPDATE routes AS trip
SET target_type = 'redirect', target_id = NULL, is_canonical = 0,
    redirect_to = (
      SELECT collection.path FROM routes AS collection
      WHERE collection.target_type = 'journey' AND collection.is_canonical = 1
        AND collection.target_id = trip.target_id AND collection.locale = trip.locale
        AND collection.path LIKE '/collections/%'
    ),
    redirect_status = 301
WHERE trip.path LIKE '/trips/%' AND trip.target_type = 'journey'
  AND EXISTS (
    SELECT 1 FROM routes AS collection
    WHERE collection.target_type = 'journey' AND collection.is_canonical = 1
      AND collection.target_id = trip.target_id AND collection.locale = trip.locale
      AND collection.path LIKE '/collections/%'
  );

-- Keep older aliases pointing directly at the canonical URL, without a chain.
UPDATE routes AS alias
SET redirect_to = (
  SELECT trip.redirect_to FROM routes AS trip
  WHERE trip.path = alias.redirect_to AND trip.locale = alias.locale
    AND trip.target_type = 'redirect' AND trip.redirect_to LIKE '/collections/%'
)
WHERE alias.target_type = 'redirect' AND alias.redirect_to LIKE '/trips/%'
  AND EXISTS (
    SELECT 1 FROM routes AS trip
    WHERE trip.path = alias.redirect_to AND trip.locale = alias.locale
      AND trip.target_type = 'redirect' AND trip.redirect_to LIKE '/collections/%'
  );
