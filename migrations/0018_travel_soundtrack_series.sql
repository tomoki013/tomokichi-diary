-- Add the editorial music series and discoverability tags.
-- Idempotent so deployment can coexist with admin-created records.
INSERT INTO collections (id, slug, kind, title, description, sort_order)
SELECT '8b34b540-2d16-4d7e-bc20-97290b6a4c9a',
       'travel-soundtrack', 'series', '旅のサウンドトラック',
       '旅先で聴きたい音楽を、街並みや旅のワンシーンとともに紹介。音楽で旅の記憶をもっと特別にするシリーズ。',
       20
WHERE NOT EXISTS (SELECT 1 FROM collections WHERE slug = 'travel-soundtrack');

INSERT INTO tags (id, slug, name)
SELECT '1b725efb-0a86-4a96-9994-0e2577c36e57', 'travel-music', '旅と音楽'
WHERE NOT EXISTS (SELECT 1 FROM tags WHERE slug = 'travel-music');

INSERT INTO tags (id, slug, name)
SELECT '5e278ac6-ef4c-4644-8470-cdb1e04d1f46', 'travel-playlist', '旅のプレイリスト'
WHERE NOT EXISTS (SELECT 1 FROM tags WHERE slug = 'travel-playlist');

INSERT INTO routes (id, path, locale, target_type, target_id, is_canonical)
SELECT '25437fae-e26c-466c-89e8-c63c0b29ecce', '/collections/travel-soundtrack', 'ja', 'series',
       (SELECT id FROM collections WHERE slug = 'travel-soundtrack'), 1
WHERE NOT EXISTS (SELECT 1 FROM routes WHERE path = '/collections/travel-soundtrack');
