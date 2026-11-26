import { MCP_ORIGIN } from "./analytics-auth.js";

const WORKERS_DEV_ORIGIN = "https://tomokichi-diary-mcp.tomoki-ttttt.workers.dev";

/**
 * Private connections (OAuth, consent, analytics, operator) answer only on
 * mcp.tomokichidiary.com; the old workers.dev issuers and the admin consent
 * proxy were retired on 2026-11-27. workers.dev keeps the public /mcp only.
 */
export function servedHere(url: URL): boolean {
  if (url.origin === MCP_ORIGIN) return true;
  return (
    url.origin === WORKERS_DEV_ORIGIN && (url.pathname === "/mcp" || url.pathname === "/health")
  );
}
