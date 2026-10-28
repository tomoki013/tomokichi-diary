-- Series theme music and the defaults an article picks up when it joins a
-- series. Additive only: every existing series starts with music off and no
-- defaults, so nothing on the site changes until the admin sets them.
-- The music is a share URL and an optional label; player markup is never stored.
ALTER TABLE collections ADD COLUMN theme_music_provider TEXT CHECK (theme_music_provider IN ('apple_music'));
ALTER TABLE collections ADD COLUMN theme_music_url TEXT;
ALTER TABLE collections ADD COLUMN theme_music_title TEXT;
ALTER TABLE collections ADD COLUMN theme_music_enabled INTEGER NOT NULL DEFAULT 0 CHECK (theme_music_enabled IN (0, 1));
ALTER TABLE collections ADD COLUMN default_tag_ids TEXT NOT NULL DEFAULT '[]';
ALTER TABLE collections ADD COLUMN default_category_ids TEXT NOT NULL DEFAULT '[]';
ALTER TABLE collections ADD COLUMN default_experience_tags TEXT NOT NULL DEFAULT '[]';
-- When the series was last edited, so the admin can tell a saved change from
-- one the site already shows. Null for records older than this column.
ALTER TABLE collections ADD COLUMN updated_at TEXT;
