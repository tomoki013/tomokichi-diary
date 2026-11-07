import { Hono } from "hono";
import { fromD1 } from "@tomokichi/infra-d1";
import type { AppEnv } from "../app.js";
import { errorResponse } from "../http.js";

const issuers = new Set(["analytics", "analytics-legacy", "operator", "operator-legacy"]);
const connectionsUrl = "https://internal/connections";

export function connectionRoutes() {
  const routes = new Hono<AppEnv>();
  routes.get("/", async (c) => {
    const binding = c.env.MCP_CONNECTIONS;
    if (!binding)
      return errorResponse(c, "API_INTERNAL", "MCP connection manager is unavailable", 503);
    const response = await binding.fetch(new Request(connectionsUrl, { method: "GET" }));
    if (!response.ok) return errorResponse(c, "API_INTERNAL", "MCP connection manager failed", 502);
    const payload = (await response.json()) as {
      items?: {
        clientId?: unknown;
        clientName?: unknown;
        clientTrust?: unknown;
        redirectHost?: unknown;
      }[];
    };
    const names = await fromD1(c.env.DB)
      .prepare("SELECT client_id,redirect_host,display_name FROM operator_audit_client_names")
      .all<{ client_id: string; redirect_host: string; display_name: string }>();
    const confirmed = new Map(
      names.map((row) => [`${row.client_id}|${row.redirect_host}`, row.display_name]),
    );
    return c.json(
      {
        ...payload,
        items: (payload.items ?? []).map((item) => {
          const id = typeof item.clientId === "string" ? item.clientId : "";
          const redirectHost =
            typeof item.redirectHost === "string" ? item.redirectHost : "unknown";
          const name = confirmed.get(`${id}|${redirectHost}`);
          return name ? { ...item, clientName: name, clientTrust: "confirmed" } : item;
        }),
      },
      200,
      { "cache-control": "private, no-store" },
    );
  });
  routes.post("/clients/:clientId/label", async (c) => {
    const clientId = c.req.param("clientId").toLowerCase();
    if (!/^[a-f0-9]{32}$/i.test(clientId))
      return errorResponse(c, "API_VALIDATION_FAILED", "invalid client identifier", 400);
    const body: unknown = await c.req.json().catch(() => null);
    const data = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const displayName =
      typeof data["displayName"] === "string" ? data["displayName"].trim().slice(0, 80) : "";
    const redirectHost =
      typeof data["redirectHost"] === "string" ? data["redirectHost"].trim().slice(0, 253) : "";
    if (!displayName || !redirectHost)
      return errorResponse(c, "API_VALIDATION_FAILED", "display name is required", 400);
    const binding = c.env.MCP_CONNECTIONS;
    if (!binding)
      return errorResponse(c, "API_INTERNAL", "MCP connection manager is unavailable", 503);
    const response = await binding.fetch(new Request(connectionsUrl));
    if (!response.ok) return errorResponse(c, "API_INTERNAL", "MCP connection manager failed", 502);
    const { items } = (await response.json()) as {
      items?: { clientId?: unknown; redirectHost?: unknown }[];
    };
    if (!items?.some((item) => item.clientId === clientId && item.redirectHost === redirectHost))
      return errorResponse(c, "API_NOT_FOUND", "client and redirect host not found", 404);
    const actor = c.get("auditContext").actorSubject ?? c.get("auditContext").actorType;
    await fromD1(c.env.DB)
      .prepare(
        `INSERT INTO operator_audit_client_names (client_id,redirect_host,display_name,confirmed_by,confirmed_at)
         VALUES (?,?,?,?,?)
         ON CONFLICT(client_id,redirect_host) DO UPDATE SET display_name=excluded.display_name,
           confirmed_by=excluded.confirmed_by, confirmed_at=excluded.confirmed_at`,
      )
      .bind(clientId, redirectHost, displayName, actor.slice(0, 160), new Date().toISOString())
      .run();
    return c.json({ clientId, redirectHost, displayName, clientTrust: "confirmed" });
  });
  routes.post("/:issuer/:grantId/revoke", async (c) => {
    const issuer = c.req.param("issuer");
    const grantId = c.req.param("grantId");
    if (!issuers.has(issuer) || !/^[A-Za-z0-9_-]{1,80}$/.test(grantId))
      return errorResponse(c, "API_VALIDATION_FAILED", "invalid connection", 400);
    const body: unknown = await c.req.json().catch(() => null);
    if (
      !body ||
      typeof body !== "object" ||
      (body as Record<string, unknown>)["confirm"] !== "revoke"
    )
      return errorResponse(
        c,
        "API_VALIDATION_FAILED",
        "connection revocation confirmation required",
        400,
      );
    const binding = c.env.MCP_CONNECTIONS;
    if (!binding)
      return errorResponse(c, "API_INTERNAL", "MCP connection manager is unavailable", 503);
    const response = await binding.fetch(
      new Request(`https://internal/connections/${issuer}/${grantId}/revoke`, { method: "POST" }),
    );
    if (response.status === 404)
      return errorResponse(c, "API_NOT_FOUND", "connection not found", 404);
    if (!response.ok) return errorResponse(c, "API_INTERNAL", "connection revocation failed", 502);
    return c.json(await response.json(), 200, { "cache-control": "private, no-store" });
  });
  return routes;
}
