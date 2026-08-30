-- Contact submissions land in the database and are read in the admin. No third
-- party sees them, and no mail provider is needed for the form to work.
CREATE TABLE contact_messages (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,
  -- Salted hash, never the address itself: enough to rate-limit a sender,
  -- not enough to identify one after the fact.
  ip_hash     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'spam')),
  created_at  TEXT NOT NULL
);
CREATE INDEX contact_messages_created ON contact_messages (created_at DESC);
CREATE INDEX contact_messages_ip ON contact_messages (ip_hash, created_at DESC);
