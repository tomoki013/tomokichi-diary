-- Private. One compact line per day for the long view (weeks and months over a
-- year or more), so a trend is a SQL sum instead of parsing every day's JSON.
-- Derived from analytics_days when a day is collected; additive numbers only.
CREATE TABLE analytics_facts (
  date TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('ga4','gsc_site','gsc_url','adsense','affiliate')),
  grain TEXT NOT NULL CHECK(grain IN ('site','channel','article','search_type')),
  key TEXT NOT NULL,
  page_views INTEGER,
  entrances INTEGER,
  engaged_entrances INTEGER,
  new_entrances INTEGER,
  clicks INTEGER,
  impressions INTEGER,
  position_sum REAL,
  earnings_jpy REAL,
  PRIMARY KEY(grain, key, source, date)
) WITHOUT ROWID;
CREATE INDEX analytics_facts_source_date ON analytics_facts(source, date);
