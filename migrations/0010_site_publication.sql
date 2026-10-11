-- One site's build state, separate from article revisions and publication dates.
CREATE TABLE site_publication (
  id TEXT PRIMARY KEY CHECK (id = 'site'),
  requested_id TEXT,
  requested_at TEXT,
  building_id TEXT,
  deployed_id TEXT,
  deployed_at TEXT,
  failed_id TEXT,
  error TEXT,
  build_url TEXT
);
INSERT INTO site_publication (id) VALUES ('site');
