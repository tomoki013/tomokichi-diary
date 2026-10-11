-- Keep saved draft metadata out of unrelated publication builds.
CREATE TABLE publication_metadata (
  revision_id TEXT PRIMARY KEY REFERENCES article_revisions(id) ON DELETE CASCADE,
  metadata TEXT NOT NULL CHECK (json_valid(metadata))
);
INSERT INTO publication_metadata (revision_id, metadata)
SELECT published_revision_id, json_object(
  'media', json((SELECT COALESCE(json_group_array(json_object('articleId', article_id, 'mediaId', media_id, 'role', role, 'sortOrder', sort_order, 'alt', alt, 'caption', caption)), '[]') FROM article_media WHERE article_id = articles.id)),
  'locations', json((SELECT COALESCE(json_group_array(json_object('articleId', article_id, 'locationId', location_id, 'relation', relation)), '[]') FROM article_locations WHERE article_id = articles.id)),
  'places', json((SELECT COALESCE(json_group_array(json_object('articleId', article_id, 'placeId', place_id, 'relation', relation)), '[]') FROM article_places WHERE article_id = articles.id)),
  'categories', json((SELECT COALESCE(json_group_array(json_object('articleId', article_id, 'categoryId', category_id)), '[]') FROM article_categories WHERE article_id = articles.id)),
  'tags', json((SELECT COALESCE(json_group_array(json_object('articleId', article_id, 'tagId', tag_id)), '[]') FROM article_tags WHERE article_id = articles.id)),
  'collections', json((SELECT COALESCE(json_group_array(json_object('articleId', article_id, 'collectionId', collection_id, 'sortOrder', sort_order)), '[]') FROM article_collections WHERE article_id = articles.id)),
  'experienceTags', json(experience_tags)
) FROM articles WHERE published_revision_id IS NOT NULL;
