-- Private read models. Never included in the public content export.
CREATE TABLE analytics_days (
  source TEXT NOT NULL CHECK(source IN ('ga4','gsc_site','gsc_url','adsense','affiliate')),
  date TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  PRIMARY KEY(source, date)
);
CREATE INDEX analytics_days_date ON analytics_days(date);
CREATE TABLE analytics_status (
  source TEXT PRIMARY KEY,
  attempted_at TEXT,
  succeeded_at TEXT,
  latest_date TEXT,
  range_start TEXT,
  range_end TEXT,
  error TEXT
);
CREATE TABLE analytics_reports (
  period TEXT NOT NULL,
  start TEXT NOT NULL,
  end TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  PRIMARY KEY(period, start, end)
);
