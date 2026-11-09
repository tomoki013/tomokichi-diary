-- Each home-page ranking can use one photo chosen by the editor.
ALTER TABLE rankings
  ADD COLUMN photo_media_id TEXT REFERENCES media_assets (id) ON DELETE SET NULL;

-- Preserve the current display for rankings that already showed a cover:
-- use the first pick's cover as the initial editorial choice.
UPDATE rankings
SET photo_media_id = (
  SELECT article_media.media_id
  FROM article_media
  WHERE article_media.article_id = json_extract(rankings.picks, '$[0].articleId')
    AND article_media.role = 'cover'
  ORDER BY article_media.sort_order
  LIMIT 1
)
WHERE photo_media_id IS NULL;
