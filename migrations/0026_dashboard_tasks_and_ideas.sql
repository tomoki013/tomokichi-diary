CREATE TABLE dashboard_tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('seo','rewrite','ad_test','affiliate','publish','planning','operations')),
  priority TEXT NOT NULL CHECK (priority IN ('P1','P2','P3')),
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','done','hold')),
  source TEXT NOT NULL CHECK (source IN ('manual','recommendation')),
  details TEXT NOT NULL DEFAULT '',
  article_id TEXT REFERENCES articles(id) ON DELETE SET NULL,
  cause_key TEXT,
  evidence_start TEXT,
  evidence_end TEXT,
  rule TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((evidence_start IS NULL AND evidence_end IS NULL) OR (evidence_start IS NOT NULL AND evidence_end IS NOT NULL AND evidence_start <= evidence_end)),
  CHECK ((source = 'manual' AND cause_key IS NULL) OR (source = 'recommendation' AND cause_key IS NOT NULL))
);
CREATE UNIQUE INDEX dashboard_tasks_cause_key ON dashboard_tasks(cause_key) WHERE cause_key IS NOT NULL;
CREATE INDEX dashboard_tasks_status_priority ON dashboard_tasks(status, priority, updated_at DESC);

CREATE TABLE dashboard_ideas (
  id TEXT PRIMARY KEY,
  provisional_title TEXT NOT NULL,
  article_kind TEXT NOT NULL CHECK (article_kind IN ('article','page')),
  series_id TEXT REFERENCES collections(id) ON DELETE SET NULL,
  summary TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL CHECK (priority IN ('P1','P2','P3')),
  status TEXT NOT NULL CHECK (status IN ('planning','drafting','ready','scheduled','hold')),
  related_article_id TEXT REFERENCES articles(id) ON DELETE SET NULL,
  linked_article_id TEXT REFERENCES articles(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX dashboard_ideas_linked_article ON dashboard_ideas(linked_article_id) WHERE linked_article_id IS NOT NULL;
CREATE INDEX dashboard_ideas_status_priority ON dashboard_ideas(status, priority, updated_at DESC);
