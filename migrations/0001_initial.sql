-- Migrations are append-only: never edit a file that has been applied.
-- Booleans are stored as 0/1 and instants as ISO-8601 text so the schema
-- transfers to Postgres or plain SQLite without a data rewrite.

CREATE TABLE authors (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  url   TEXT,
  bio   TEXT
);

CREATE TABLE articles (
  id                     TEXT PRIMARY KEY,
  status                 TEXT NOT NULL CHECK (status IN ('draft', 'scheduled', 'published', 'archived')),
  locale                 TEXT NOT NULL,
  slug                   TEXT NOT NULL,
  author_id              TEXT NOT NULL REFERENCES authors (id),
  current_revision_id    TEXT,
  published_revision_id  TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL,
  scheduled_at           TEXT,
  published_at           TEXT,
  archived_at            TEXT,
  noindex                INTEGER NOT NULL DEFAULT 0,
  UNIQUE (slug, locale)
);
CREATE INDEX articles_status_published_at ON articles (status, published_at DESC);

CREATE TABLE article_revisions (
  id                        TEXT PRIMARY KEY,
  article_id                TEXT NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
  revision_number           INTEGER NOT NULL,
  title                     TEXT NOT NULL,
  summary                   TEXT NOT NULL,
  body_markdown             TEXT NOT NULL,
  seo_title_override        TEXT,
  seo_description_override  TEXT,
  change_summary            TEXT,
  created_at                TEXT NOT NULL,
  created_by                TEXT NOT NULL REFERENCES authors (id),
  UNIQUE (article_id, revision_number)
);
CREATE INDEX article_revisions_article ON article_revisions (article_id, revision_number DESC);

CREATE TABLE article_embeds (
  id              TEXT PRIMARY KEY,
  revision_id     TEXT NOT NULL REFERENCES article_revisions (id) ON DELETE CASCADE,
  anchor_key      TEXT NOT NULL,
  type            TEXT NOT NULL,
  schema_version  INTEGER NOT NULL DEFAULT 1,
  payload         TEXT NOT NULL,
  UNIQUE (revision_id, anchor_key)
);

CREATE TABLE routes (
  id               TEXT PRIMARY KEY,
  path             TEXT NOT NULL UNIQUE,
  locale           TEXT NOT NULL,
  target_type      TEXT NOT NULL,
  target_id        TEXT,
  is_canonical     INTEGER NOT NULL DEFAULT 0,
  redirect_to      TEXT,
  redirect_status  INTEGER,
  is_legacy        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX routes_target ON routes (target_type, target_id);

CREATE TABLE locations (
  id                TEXT PRIMARY KEY,
  slug              TEXT NOT NULL UNIQUE,
  type              TEXT NOT NULL,
  parent_id         TEXT REFERENCES locations (id),
  country_code      TEXT,
  subdivision_code  TEXT,
  latitude          REAL,
  longitude         REAL,
  timezone          TEXT
);
CREATE INDEX locations_parent ON locations (parent_id);

CREATE TABLE location_names (
  location_id     TEXT NOT NULL REFERENCES locations (id) ON DELETE CASCADE,
  locale          TEXT NOT NULL,
  name            TEXT NOT NULL,
  short_name      TEXT,
  romanized_name  TEXT,
  PRIMARY KEY (location_id, locale)
);

CREATE TABLE places (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  location_id   TEXT NOT NULL REFERENCES locations (id),
  kind          TEXT NOT NULL,
  name          TEXT NOT NULL,
  address       TEXT,
  latitude      REAL,
  longitude     REAL,
  official_url  TEXT,
  status        TEXT NOT NULL DEFAULT 'unknown'
);
CREATE INDEX places_location ON places (location_id);

CREATE TABLE media_assets (
  id           TEXT PRIMARY KEY,
  storage_key  TEXT NOT NULL UNIQUE,
  mime_type    TEXT NOT NULL,
  width        INTEGER,
  height       INTEGER,
  size         INTEGER NOT NULL,
  sha256       TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL
);

CREATE TABLE article_media (
  article_id  TEXT NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
  media_id    TEXT NOT NULL REFERENCES media_assets (id),
  role        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  alt         TEXT NOT NULL,
  caption     TEXT,
  PRIMARY KEY (article_id, media_id, role)
);

CREATE TABLE categories (
  id           TEXT PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  description  TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE tags (
  id    TEXT PRIMARY KEY,
  slug  TEXT NOT NULL UNIQUE,
  name  TEXT NOT NULL
);

CREATE TABLE article_locations (
  article_id   TEXT NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
  location_id  TEXT NOT NULL REFERENCES locations (id),
  relation     TEXT NOT NULL,
  PRIMARY KEY (article_id, location_id, relation)
);

CREATE TABLE article_places (
  article_id  TEXT NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
  place_id    TEXT NOT NULL REFERENCES places (id),
  relation    TEXT NOT NULL,
  PRIMARY KEY (article_id, place_id, relation)
);

CREATE TABLE article_categories (
  article_id   TEXT NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
  category_id  TEXT NOT NULL REFERENCES categories (id),
  PRIMARY KEY (article_id, category_id)
);

CREATE TABLE article_tags (
  article_id  TEXT NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
  tag_id      TEXT NOT NULL REFERENCES tags (id),
  PRIMARY KEY (article_id, tag_id)
);

-- Generated output is kept beside the content it describes, never inside it.
CREATE TABLE ai_artifacts (
  id                  TEXT PRIMARY KEY,
  entity_type         TEXT NOT NULL,
  entity_id           TEXT NOT NULL,
  source_revision_id  TEXT,
  kind                TEXT NOT NULL,
  content             TEXT NOT NULL,
  created_at          TEXT NOT NULL,
  generator           TEXT NOT NULL
);
CREATE INDEX ai_artifacts_entity ON ai_artifacts (entity_type, entity_id, kind);
