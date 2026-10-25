-- AI-generated illustrations can sit in an article, captioned as such, but the
-- gallery is for photographs taken on the road. The flag lives on the asset
-- rather than on each usage: what made the image does not change by article.
ALTER TABLE media_assets ADD COLUMN ai_generated INTEGER NOT NULL DEFAULT 0 CHECK(ai_generated IN (0, 1));

-- Images already in use were captioned "AI生成" by hand before the flag
-- existed; carry that over once.
UPDATE media_assets SET ai_generated = 1
WHERE id IN (
  SELECT media_id FROM article_media
  WHERE alt LIKE '%AI生成%' OR caption LIKE '%AI生成%'
);

-- One like per anonymous browser identity and photograph, the same shape as
-- article_likes. The identity is hashed by the API before it reaches here.
CREATE TABLE media_likes (
  media_id     TEXT NOT NULL REFERENCES media_assets (id) ON DELETE CASCADE,
  visitor_hash TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (media_id, visitor_hash)
);

CREATE INDEX idx_media_likes_media_id ON media_likes (media_id);
