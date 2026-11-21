-- Private. Switches the owner sets in the admin and nothing else may change:
-- one row per key. `inquiry.mcp_access` is "1" while the Operator MCP may read
-- the inbox, "0" (or no row) otherwise.
CREATE TABLE admin_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
