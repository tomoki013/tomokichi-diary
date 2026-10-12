-- Exact non-additive GA4 counts. No identifiers or sketches are persisted.
CREATE TABLE analytics_period_counts (
  start TEXT NOT NULL,
  end TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  PRIMARY KEY(start, end)
);
