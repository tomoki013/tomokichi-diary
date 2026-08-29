-- Series and journeys: ordered groups of articles, each with its own URL space.

CREATE TABLE collections (
  id             TEXT PRIMARY KEY,
  slug           TEXT NOT NULL UNIQUE,
  kind           TEXT NOT NULL CHECK (kind IN ('series', 'journey')),
  title          TEXT NOT NULL,
  description    TEXT,
  cover_media_id TEXT REFERENCES media_assets (id),
  start_date     TEXT,
  end_date       TEXT,
  sort_order     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE article_collections (
  article_id     TEXT NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
  collection_id  TEXT NOT NULL REFERENCES collections (id) ON DELETE CASCADE,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (article_id, collection_id)
);
CREATE INDEX article_collections_collection ON article_collections (collection_id, sort_order);
