-- Diary notes share the article/revision lifecycle and media graph, with a
-- small explicit relation table for optional links to travel articles.
CREATE TABLE note_related_articles (
  note_id     TEXT NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
  article_id  TEXT NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (note_id, article_id),
  CHECK (note_id <> article_id)
);
CREATE INDEX note_related_articles_target ON note_related_articles (article_id, sort_order);

-- A built-in index route exists even before the first note is written.
INSERT OR IGNORE INTO routes (
  id, path, locale, target_type, target_id, is_canonical, redirect_to,
  redirect_status, is_legacy, noindex
) VALUES (
  'c9f20a60-7a65-4e4d-8c0f-0f5b4c1a0024', '/notes', 'ja', 'static', 'notes',
  1, NULL, NULL, 0, 0
);
