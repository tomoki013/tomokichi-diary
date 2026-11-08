import { Hono } from "hono";
import { fromD1 } from "@tomokichi/infra-d1";
import type { AppEnv } from "../app.js";
import { errorResponse } from "../http.js";

const allowedResults = new Set(["requested", "succeeded", "failed", "rejected"]);
const allowedTargets = new Set([
  "article",
  "note",
  "series",
  "tag",
  "ranking",
  "ad",
  "publication",
  "media",
  "connection",
  "admin",
]);

function parseUtcDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? parsed
    : null;
}

export function activityRoutes() {
  const routes = new Hono<AppEnv>();
  routes.get("/", async (c) => {
    const pageRaw = Number(c.req.query("page") ?? 1);
    const limitRaw = Number(c.req.query("limit") ?? 50);
    const page = Number.isInteger(pageRaw) ? Math.max(1, Math.min(100_000, pageRaw)) : 1;
    const limit = Number.isInteger(limitRaw) ? Math.max(1, Math.min(100, limitRaw)) : 50;
    const result = c.req.query("result");
    const targetType = c.req.query("targetType");
    if (result && !allowedResults.has(result))
      return errorResponse(c, "API_VALIDATION_FAILED", "invalid activity result", 400);
    if (targetType && !allowedTargets.has(targetType))
      return errorResponse(c, "API_VALIDATION_FAILED", "invalid activity target", 400);

    const clauses: string[] = [];
    const values: unknown[] = [];
    const start = c.req.query("start");
    const end = c.req.query("end");
    if (start) {
      const parsed = parseUtcDate(start);
      if (!parsed) return errorResponse(c, "API_VALIDATION_FAILED", "invalid start date", 400);
      clauses.push("e.occurred_at >= ?");
      values.push(parsed.toISOString());
    }
    if (end) {
      const parsed = parseUtcDate(end);
      if (!parsed) return errorResponse(c, "API_VALIDATION_FAILED", "invalid end date", 400);
      parsed.setUTCDate(parsed.getUTCDate() + 1);
      clauses.push("e.occurred_at < ?");
      values.push(parsed.toISOString());
    }
    const client = c.req.query("client")?.trim().slice(0, 120);
    if (client) {
      if (client === "unknown") clauses.push("e.client_trust = 'unknown'");
      else {
        clauses.push("(COALESCE(confirmed.display_name,e.client_name) = ? OR e.client_id = ?)");
        values.push(client, client);
      }
    }
    const action = c.req.query("action")?.trim().slice(0, 100);
    if (action) {
      clauses.push("e.action LIKE ? ESCAPE '\\'");
      values.push(`${action.replace(/[\\%_]/g, "\\$&")}%`);
    }
    const targetId = c.req.query("targetId")?.trim().slice(0, 120);
    if (targetType) {
      clauses.push("e.target_type = ?");
      values.push(targetType);
    }
    if (targetId) {
      clauses.push("e.target_id = ?");
      values.push(targetId);
    }
    if (result) {
      clauses.push("e.result = ?");
      values.push(result);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const db = fromD1(c.env.DB);
    const [countRow, rows] = await Promise.all([
      db
        .prepare(
          `SELECT COUNT(*) AS total FROM operator_audit_events e LEFT JOIN operator_audit_client_names confirmed ON confirmed.client_id=e.client_id AND confirmed.redirect_host=e.client_redirect_host ${where}`,
        )
        .bind(...values)
        .first<{ total: number }>(),
      db
        .prepare(
          `SELECT e.id,e.occurred_at,e.request_id,e.actor_type,e.actor_subject,e.client_id,
                COALESCE(confirmed.display_name,e.client_name) AS client_name,
                CASE WHEN confirmed.display_name IS NULL THEN e.client_trust ELSE 'confirmed' END AS client_trust,
                e.source,e.action,e.target_type,e.target_id,e.result,e.status_code,e.metadata,
                e.oauth_grant_ref,e.mcp_tool_name,e.publication_id,e.client_redirect_host
         FROM operator_audit_events e LEFT JOIN operator_audit_client_names confirmed ON confirmed.client_id=e.client_id AND confirmed.redirect_host=e.client_redirect_host ${where}
         ORDER BY e.occurred_at DESC, e.id DESC LIMIT ? OFFSET ?`,
        )
        .bind(...values, limit, (page - 1) * limit)
        .all<Record<string, unknown>>(),
    ]);
    const items = rows.map((row) => ({
      id: row["id"],
      occurredAt: row["occurred_at"],
      requestId: row["request_id"],
      actorType: row["actor_type"],
      actorSubject: row["actor_subject"],
      clientId: row["client_id"],
      clientName: row["client_name"],
      clientTrust: row["client_trust"],
      source: row["source"],
      action: row["action"],
      targetType: row["target_type"],
      targetId: row["target_id"],
      result: row["result"],
      statusCode: row["status_code"],
      metadata: JSON.parse(String(row["metadata"] ?? "{}")) as Record<string, unknown>,
      oauthGrantRef: row["oauth_grant_ref"],
      mcpToolName: row["mcp_tool_name"],
      publicationId: row["publication_id"],
      clientRedirectHost: row["client_redirect_host"],
    }));
    const total = Number(countRow?.total ?? 0);
    return c.json({ items, page, limit, total, pages: Math.ceil(total / limit) }, 200, {
      "cache-control": "private, no-store",
    });
  });
  return routes;
}
