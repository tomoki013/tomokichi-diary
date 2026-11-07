CREATE TABLE operator_audit_events (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  request_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_subject TEXT,
  client_id TEXT,
  client_name TEXT,
  client_trust TEXT NOT NULL CHECK (client_trust IN ('confirmed', 'self-asserted', 'unknown')),
  client_redirect_host TEXT,
  source TEXT NOT NULL CHECK (source IN ('admin', 'remote-mcp', 'local-mcp', 'system')),
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  result TEXT NOT NULL CHECK (result IN ('requested', 'succeeded', 'failed', 'rejected')),
  status_code INTEGER,
  metadata TEXT NOT NULL DEFAULT '{}',
  oauth_grant_ref TEXT,
  mcp_tool_name TEXT,
  publication_id TEXT
);

CREATE INDEX operator_audit_events_occurred_at
  ON operator_audit_events(occurred_at DESC, id DESC);
CREATE INDEX operator_audit_events_client
  ON operator_audit_events(client_id, occurred_at DESC);
CREATE INDEX operator_audit_events_action
  ON operator_audit_events(action, occurred_at DESC);
CREATE INDEX operator_audit_events_target
  ON operator_audit_events(target_type, target_id, occurred_at DESC);
CREATE INDEX operator_audit_events_result
  ON operator_audit_events(result, occurred_at DESC);
CREATE INDEX operator_audit_events_publication
  ON operator_audit_events(publication_id, occurred_at DESC);

CREATE TABLE operator_audit_client_names (
  client_id TEXT NOT NULL,
  redirect_host TEXT NOT NULL,
  display_name TEXT NOT NULL,
  confirmed_by TEXT NOT NULL,
  confirmed_at TEXT NOT NULL,
  PRIMARY KEY (client_id, redirect_host)
);
