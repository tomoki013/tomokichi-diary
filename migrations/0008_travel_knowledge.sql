-- Travel knowledge is separate from article prose and URL routes. JSON columns
-- hold small value-object collections; entity identity and foreign keys remain
-- queryable and portable.
CREATE TABLE source_references (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('firsthand-note', 'official', 'external')),
  name        TEXT NOT NULL,
  url         TEXT,
  checked_at  TEXT
);

CREATE TABLE travel_routes (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  mode              TEXT NOT NULL CHECK (mode IN ('walk', 'bus', 'train', 'car', 'air', 'mixed')),
  start_json        TEXT NOT NULL,
  waypoints_json    TEXT NOT NULL,
  end_json          TEXT NOT NULL,
  duration_minutes  INTEGER,
  distance_km       REAL,
  experienced_at    TEXT,
  provenance        TEXT NOT NULL CHECK (provenance IN ('firsthand', 'official', 'researched', 'derived')),
  note              TEXT
);

CREATE TABLE travel_facts (
  id                TEXT PRIMARY KEY,
  kind              TEXT NOT NULL,
  statement         TEXT NOT NULL,
  provenance        TEXT NOT NULL CHECK (provenance IN ('firsthand', 'official', 'researched', 'derived')),
  status            TEXT NOT NULL CHECK (status IN ('candidate', 'verified')),
  experienced_at    TEXT,
  verified_at       TEXT,
  value_json        TEXT,
  volatility        TEXT CHECK (volatility IN ('low', 'medium', 'high')),
  article_ids_json  TEXT NOT NULL,
  place_ids_json    TEXT NOT NULL,
  source_ids_json   TEXT NOT NULL,
  travel_route_id   TEXT REFERENCES travel_routes (id),
  verified_by       TEXT REFERENCES authors (id)
);
CREATE INDEX travel_facts_provenance ON travel_facts (provenance, status);

CREATE TABLE article_knowledge (
  article_id              TEXT NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
  revision_id             TEXT NOT NULL REFERENCES article_revisions (id) ON DELETE CASCADE,
  schema_version          INTEGER NOT NULL DEFAULT 1,
  quick_answer_json       TEXT,
  decision_table_json     TEXT,
  experience_groups_json  TEXT NOT NULL,
  current_fact_ids_json   TEXT NOT NULL,
  caution_fact_ids_json   TEXT NOT NULL,
  route_ids_json          TEXT NOT NULL,
  related_articles_json   TEXT NOT NULL,
  PRIMARY KEY (article_id, revision_id)
);
