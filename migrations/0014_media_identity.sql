-- Preserve every legacy id, key and sha256 (also used in derivative URLs).
ALTER TABLE media_assets ADD COLUMN original_name TEXT;
ALTER TABLE media_assets ADD COLUMN slug TEXT;
ALTER TABLE media_assets ADD COLUMN content_sha256 TEXT CHECK(content_sha256 IS NULL OR length(content_sha256) = 64);
CREATE UNIQUE INDEX media_slug_unique ON media_assets(slug) WHERE slug IS NOT NULL;
CREATE TABLE media_slug_aliases (
  slug TEXT PRIMARY KEY,
  media_id TEXT NOT NULL REFERENCES media_assets(id)
);

-- Several legacy rows may contain identical bytes. Only this canonical lookup
-- is unique; their original rows and article references remain intact.
CREATE TABLE media_hashes (
  sha256 TEXT PRIMARY KEY CHECK(length(sha256) = 64),
  media_id TEXT NOT NULL REFERENCES media_assets(id)
);
CREATE INDEX media_content_hash ON media_assets(content_sha256);

-- A reservation survives a Worker interruption so recovery can account for
-- every object. It must never be stolen from a potentially active writer.
CREATE TABLE media_uploads (
  sha256 TEXT PRIMARY KEY,
  media_id TEXT NOT NULL UNIQUE,
  asset_json TEXT NOT NULL,
  started_at TEXT NOT NULL
);
