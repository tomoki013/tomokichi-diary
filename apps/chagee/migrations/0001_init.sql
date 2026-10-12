-- CHAGEE guide schema. This database belongs to the CHAGEE guide Worker only;
-- the travel blog's D1 (tomokichi-diary) is a different database.
--
-- List-valued fields are JSON arrays in TEXT columns: the data set is small and
-- always read whole, so a join table per list would only add queries.
-- Dates are ISO 8601 strings. `checked_at` is when the facts were last confirmed
-- against an official source or in person; NULL means unconfirmed.

CREATE TABLE menus (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  name_ja TEXT NOT NULL,
  name_zh TEXT NOT NULL,
  name_en TEXT NOT NULL,
  short_description TEXT NOT NULL,
  description TEXT NOT NULL,
  image_key TEXT,
  category TEXT NOT NULL CHECK (category IN ('straight', 'milk', 'fruit', 'seasonal')),
  tea_base TEXT NOT NULL CHECK (tea_base IN ('jasmine', 'oolong', 'green', 'black')),
  tea_detail TEXT NOT NULL,
  milk_type TEXT NOT NULL CHECK (milk_type IN ('fresh-milk', 'none')),
  sweetness TEXT NOT NULL CHECK (sweetness IN ('light', 'normal', 'sweet')),
  -- 1 (rich, heavy) .. 5 (light, refreshing); drives the "さっぱり順" sort.
  lightness INTEGER NOT NULL CHECK (lightness BETWEEN 1 AND 5),
  -- 1 .. 5; drives the "人気順" sort. An editorial judgement, not sales data.
  popularity INTEGER NOT NULL CHECK (popularity BETWEEN 1 AND 5),
  temperatures TEXT NOT NULL DEFAULT '["iced"]',
  aroma_tags TEXT NOT NULL DEFAULT '[]',
  flavor_tags TEXT NOT NULL DEFAULT '[]',
  beginner_friendly INTEGER NOT NULL DEFAULT 0,
  -- [{"country":"cn","note":"..."}]
  availability TEXT NOT NULL DEFAULT '[]',
  price_notes TEXT NOT NULL DEFAULT '[]',
  recommended_for TEXT NOT NULL DEFAULT '[]',
  not_recommended_for TEXT NOT NULL DEFAULT '[]',
  -- Firsthand: the editor drank it. Rating and comment are only set when true.
  tasted INTEGER NOT NULL DEFAULT 0,
  editor_rating INTEGER CHECK (editor_rating BETWEEN 1 AND 5),
  editor_comment TEXT,
  -- Full URLs of the travel-blog posts that cover this menu.
  blog_links TEXT NOT NULL DEFAULT '[]',
  sources TEXT NOT NULL DEFAULT '[]',
  checked_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE stores (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  name TEXT NOT NULL,
  name_local TEXT,
  country TEXT NOT NULL,
  city TEXT NOT NULL,
  area TEXT NOT NULL,
  address TEXT,
  opening_hours TEXT,
  access TEXT,
  map_url TEXT,
  map_label TEXT,
  features TEXT NOT NULL DEFAULT '[]',
  cautions TEXT NOT NULL DEFAULT '[]',
  good_for TEXT NOT NULL DEFAULT '[]',
  ordering TEXT,
  editor_comment TEXT,
  visited INTEGER NOT NULL DEFAULT 0,
  visited_on TEXT,
  editor_pick INTEGER NOT NULL DEFAULT 0,
  image_keys TEXT NOT NULL DEFAULT '[]',
  blog_links TEXT NOT NULL DEFAULT '[]',
  checked_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX stores_country_city ON stores (country, city);

CREATE TABLE news (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  -- Markdown subset: ## / ### headings, paragraphs, - lists, **bold**, [links](url).
  body TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('japan', 'product', 'store', 'overseas', 'media')),
  -- official: the company said so. reported: a news outlet said so.
  -- unverified: rumour or unconfirmed; shown with a warning.
  verification_status TEXT NOT NULL CHECK (verification_status IN ('official', 'reported', 'unverified')),
  -- [{"name":"...","url":"..."}]
  sources TEXT NOT NULL DEFAULT '[]',
  cover_key TEXT,
  published_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX news_published ON news (status, published_at DESC);

-- Columns and travel reports live on the travel blog. This table only lists
-- them so the guide can link out; nothing is copied.
CREATE TABLE column_links (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL CHECK (category IN ('report', 'menu', 'travel', 'compare')),
  country TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  published_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
