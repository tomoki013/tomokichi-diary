import { getLikeActivity, listArticlesForAdmin, listPendingFacts } from "@tomokichi/application";
import type { ActivityItemDto, ConnectionDto, HomeTaskDto } from "@tomokichi/contracts";
import { publicationStatus } from "../../publication.js";
import { invalid, notFound, OpError, type Handlers, type OpScope } from "../scope.js";

type Names =
  | "home.get"
  | "publication.status"
  | "publication.run"
  | "like.activity"
  | "activity.list"
  | "connection.list"
  | "connection.label"
  | "connection.revoke";

const status = (scope: OpScope) =>
  publicationStatus(scope.db(), Boolean(scope.env.GITHUB_PUBLISH_TOKEN));

function utcDay(value: string): Date {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
    throw invalid(`invalid date ${value}`);
  return parsed;
}

/** The MCP Worker's private entrypoint for the OAuth grants it holds. */
function connections(scope: OpScope) {
  const binding = scope.env.MCP_CONNECTIONS;
  if (!binding) throw new OpError("API_INTERNAL", "MCP connection manager is unavailable", 503);
  return binding;
}

async function listConnections(scope: OpScope): Promise<ConnectionDto[]> {
  const response = await connections(scope).fetch(new Request("https://internal/connections"));
  if (!response.ok) throw new OpError("API_INTERNAL", "MCP connection manager failed", 502);
  const payload = (await response.json()) as { items?: ConnectionDto[] };
  const names = await scope
    .db()
    .prepare("SELECT client_id,redirect_host,display_name FROM operator_audit_client_names")
    .all<{ client_id: string; redirect_host: string; display_name: string }>();
  const confirmed = new Map(
    names.map((row) => [`${row.client_id}|${row.redirect_host}`, row.display_name]),
  );
  return (payload.items ?? []).map((item) => {
    const name = confirmed.get(`${item.clientId}|${item.redirectHost ?? "unknown"}`);
    return name ? { ...item, clientName: name, clientTrust: "confirmed" } : item;
  });
}

const HOME_LIST = 5;

export const siteHandlers: Handlers<Names> = {
  /*
   * What needs the owner now, most pressing first. Deliberately cheap: a few
   * list reads and no per-article checks, so the first screen stays fast.
   */
  "home.get": async (scope) => {
    const { ctx } = scope;
    const [publication, summaries, pending] = await Promise.all([
      status(scope),
      listArticlesForAdmin(ctx),
      listPendingFacts(ctx),
    ]);
    const tasks: HomeTaskDto[] = [];
    if (publication.state === "failed")
      tasks.push({
        kind: "publication-failed",
        title: "サイトへの反映に失敗しています",
        detail: publication.error ?? publication.errorCode,
        href: "#/site",
      });
    const href = (kind: string, id: string) =>
      kind === "note" ? `#/notes/${id}` : `#/articles/${id}`;
    const active = summaries
      .filter(({ article }) => article.status !== "archived")
      .toSorted((a, b) => b.article.updatedAt.localeCompare(a.article.updatedAt));
    for (const { article, title } of active.filter(({ article }) => article.status === "scheduled"))
      tasks.push({
        kind: "scheduled",
        title,
        detail: article.scheduledAt,
        href: href(article.kind, article.id),
      });
    const changed = active.filter((item) => item.isLive && item.hasUnpublishedChanges);
    for (const { article, title } of changed.slice(0, HOME_LIST))
      tasks.push({
        kind: "unpublished-changes",
        title,
        detail: "公開していない変更があります",
        href: href(article.kind, article.id),
      });
    if (changed.length > HOME_LIST)
      tasks.push({
        kind: "unpublished-changes",
        title: `ほか ${changed.length - HOME_LIST} 件に未公開の変更`,
        detail: null,
        href: "#/articles?filter=changed",
        count: changed.length - HOME_LIST,
      });
    if (scope.channel === "admin") {
      // The inbox belongs to the admin alone; an MCP caller never learns its size.
      const operator = scope.inquiry();
      const page = operator
        ? await operator.listTickets({ limit: 100, offset: 0 }).catch(() => null)
        : null;
      const open = page?.ok
        ? page.value.items.filter((t) => t.status !== "RESOLVED" && t.status !== "CLOSED").length
        : 0;
      if (open > 0)
        tasks.push({
          kind: "open-inquiries",
          title: `未対応の問い合わせ ${open} 件`,
          detail: null,
          href: "#/inquiries",
          count: open,
        });
    }
    if (pending.length > 0)
      tasks.push({
        kind: "pending-facts",
        title: `確認待ちの事実 ${pending.length} 件`,
        detail: null,
        href: "#/knowledge",
        count: pending.length,
      });
    const drafts = active.filter(({ article }) => article.status === "draft");
    for (const { article, title } of drafts.slice(0, HOME_LIST))
      tasks.push({
        kind: "draft",
        title: title || article.slug,
        detail: "書きかけの下書き",
        href: href(article.kind, article.id),
      });
    if (drafts.length > HOME_LIST)
      tasks.push({
        kind: "draft",
        title: `ほか ${drafts.length - HOME_LIST} 件の下書き`,
        detail: null,
        href: "#/articles?filter=draft",
        count: drafts.length - HOME_LIST,
      });
    return { publication, tasks };
  },

  "publication.status": (scope) => status(scope),

  "publication.run": (scope) => scope.publishSite(),

  "like.activity": ({ ctx }) => getLikeActivity(ctx),

  "activity.list": async (scope, input) => {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (input.start) {
      clauses.push("e.occurred_at >= ?");
      values.push(utcDay(input.start).toISOString());
    }
    if (input.end) {
      const end = utcDay(input.end);
      end.setUTCDate(end.getUTCDate() + 1);
      clauses.push("e.occurred_at < ?");
      values.push(end.toISOString());
    }
    const client = input.client?.trim();
    if (client === "unknown") clauses.push("e.client_trust = 'unknown'");
    else if (client) {
      clauses.push("(COALESCE(confirmed.display_name,e.client_name) = ? OR e.client_id = ?)");
      values.push(client, client);
    }
    const action = input.action?.trim();
    if (action) {
      clauses.push("e.action LIKE ? ESCAPE '\\'");
      values.push(`${action.replace(/[\\%_]/g, "\\$&")}%`);
    }
    if (input.targetType) {
      clauses.push("e.target_type = ?");
      values.push(input.targetType);
    }
    if (input.targetId?.trim()) {
      clauses.push("e.target_id = ?");
      values.push(input.targetId.trim());
    }
    if (input.result) {
      clauses.push("e.result = ?");
      values.push(input.result);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const from = `FROM operator_audit_events e LEFT JOIN operator_audit_client_names confirmed
      ON confirmed.client_id=e.client_id AND confirmed.redirect_host=e.client_redirect_host ${where}`;
    const db = scope.db();
    const [countRow, rows] = await Promise.all([
      db
        .prepare(`SELECT COUNT(*) AS total ${from}`)
        .bind(...values)
        .first<{ total: number }>(),
      db
        .prepare(
          `SELECT e.id,e.occurred_at,e.request_id,e.actor_type,e.actor_subject,e.client_id,
                COALESCE(confirmed.display_name,e.client_name) AS client_name,
                CASE WHEN confirmed.display_name IS NULL THEN e.client_trust ELSE 'confirmed' END AS client_trust,
                e.source,e.action,e.target_type,e.target_id,e.result,e.status_code,e.metadata,
                e.oauth_grant_ref,e.mcp_tool_name,e.publication_id,e.client_redirect_host
         ${from} ORDER BY e.occurred_at DESC, e.id DESC LIMIT ? OFFSET ?`,
        )
        .bind(...values, input.limit, (input.page - 1) * input.limit)
        .all<Record<string, unknown>>(),
    ]);
    const text = (value: unknown) => (typeof value === "string" ? value : null);
    const items = rows.map((row): ActivityItemDto => ({
      id: String(row["id"]),
      occurredAt: String(row["occurred_at"]),
      requestId: String(row["request_id"]),
      actorType: String(row["actor_type"]),
      actorSubject: text(row["actor_subject"]),
      clientId: text(row["client_id"]),
      clientName: text(row["client_name"]),
      clientTrust: String(row["client_trust"]),
      source: String(row["source"]),
      action: String(row["action"]),
      targetType: text(row["target_type"]),
      targetId: text(row["target_id"]),
      result: String(row["result"]),
      statusCode: typeof row["status_code"] === "number" ? row["status_code"] : null,
      metadata: JSON.parse(String(row["metadata"] ?? "{}")) as Record<string, unknown>,
      oauthGrantRef: text(row["oauth_grant_ref"]),
      mcpToolName: text(row["mcp_tool_name"]),
      publicationId: text(row["publication_id"]),
      clientRedirectHost: text(row["client_redirect_host"]),
    }));
    const total = Number(countRow?.total ?? 0);
    return {
      items,
      page: input.page,
      limit: input.limit,
      total,
      pages: Math.ceil(total / input.limit),
    };
  },

  "connection.list": async (scope) => ({ items: await listConnections(scope) }),

  "connection.label": async (scope, input) => {
    const clientId = input.clientId.toLowerCase();
    const displayName = input.displayName.trim();
    const redirectHost = input.redirectHost.trim();
    if (!displayName || !redirectHost) throw invalid("display name is required", "displayName");
    const response = await connections(scope).fetch(new Request("https://internal/connections"));
    if (!response.ok) throw new OpError("API_INTERNAL", "MCP connection manager failed", 502);
    const { items } = (await response.json()) as {
      items?: { clientId?: unknown; redirectHost?: unknown }[];
    };
    if (!items?.some((item) => item.clientId === clientId && item.redirectHost === redirectHost))
      throw notFound("API_NOT_FOUND", "client and redirect host not found");
    const actor = scope.audit.actorSubject ?? scope.audit.actorType;
    await scope
      .db()
      .prepare(
        `INSERT INTO operator_audit_client_names (client_id,redirect_host,display_name,confirmed_by,confirmed_at)
         VALUES (?,?,?,?,?)
         ON CONFLICT(client_id,redirect_host) DO UPDATE SET display_name=excluded.display_name,
           confirmed_by=excluded.confirmed_by, confirmed_at=excluded.confirmed_at`,
      )
      .bind(clientId, redirectHost, displayName, actor.slice(0, 160), new Date().toISOString())
      .run();
    return { clientId, redirectHost, displayName, clientTrust: "confirmed" };
  },

  // Reachable from the admin only: a connection must not be able to cut another.
  "connection.revoke": async (scope, { issuer, grantId }) => {
    const response = await connections(scope).fetch(
      new Request(`https://internal/connections/${issuer}/${grantId}/revoke`, { method: "POST" }),
    );
    if (response.status === 404) throw notFound("API_NOT_FOUND", "connection not found");
    if (!response.ok) throw new OpError("API_INTERNAL", "connection revocation failed", 502);
    return (await response.json()) as Record<string, unknown>;
  },
};
