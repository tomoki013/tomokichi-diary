-- NULL preserves legacy membership. A JSON array gives the revision's journey IDs.
ALTER TABLE article_revisions ADD COLUMN journey_ids TEXT
  CHECK (journey_ids IS NULL OR (json_valid(journey_ids) AND json_type(journey_ids) = 'array'));
