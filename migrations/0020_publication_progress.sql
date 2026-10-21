-- Expand only: old API/workflow versions can continue using site_publication.
ALTER TABLE site_publication ADD COLUMN active_build_id TEXT;
CREATE TABLE publication_builds (
  build_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  started_at TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'data',
  stage_started_at TEXT NOT NULL,
  finished_at TEXT,
  state TEXT NOT NULL DEFAULT 'building',
  duration_ms INTEGER,
  error_code TEXT,
  error TEXT,
  build_url TEXT,
  stages TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX publication_builds_request ON publication_builds(request_id, started_at);
CREATE TABLE publication_targets (
  target TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  deployed_at TEXT NOT NULL
);
