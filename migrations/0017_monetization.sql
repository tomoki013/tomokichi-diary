-- Expand only. Existing articles keep their legacy single end placement without backfill.
CREATE TABLE monetization_settings (
  id TEXT PRIMARY KEY CHECK (id = 'site'),
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  updated_at TEXT NOT NULL
);
CREATE TABLE article_monetization (
  article_id TEXT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  updated_at TEXT NOT NULL
);
CREATE TABLE affiliate_offers (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('draft','ready','paused','archived')),
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  updated_at TEXT NOT NULL
);
CREATE TABLE monetization_placements (
  article_id TEXT NOT NULL REFERENCES article_monetization(article_id) ON DELETE CASCADE,
  placement_key TEXT NOT NULL,
  offer_id TEXT REFERENCES affiliate_offers(id) ON DELETE RESTRICT,
  PRIMARY KEY (article_id, placement_key)
);
CREATE TABLE ad_experiments (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('draft','running','stopped')),
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ad_experiments_one_running ON ad_experiments(article_id) WHERE status = 'running';
-- Public configuration is frozen inside existing publication_metadata on article publish.
