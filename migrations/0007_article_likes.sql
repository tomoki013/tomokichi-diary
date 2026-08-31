-- One reaction per anonymous browser identity and article. The identity is
-- hashed by the API before it reaches this table.
CREATE TABLE article_likes (
  article_id   TEXT NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
  visitor_hash TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (article_id, visitor_hash)
);

CREATE INDEX idx_article_likes_article_id ON article_likes (article_id);
PRAGMA optimize;
