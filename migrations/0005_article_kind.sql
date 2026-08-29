-- About, FAQ and the legal pages are editorial content with titles, bodies and
-- revisions — the same shape as an article. `kind` keeps them out of article
-- listings and feeds without giving them a parallel entity.
ALTER TABLE articles ADD COLUMN kind TEXT NOT NULL DEFAULT 'article';
