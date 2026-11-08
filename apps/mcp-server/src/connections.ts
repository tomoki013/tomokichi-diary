import { WorkerEntrypoint } from "cloudflare:workers";
import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { fromD1 } from "@tomokichi/infra-d1";
import { analyticsOAuthHelpers, type AnalyticsEnv } from "./analytics-auth.js";
import {
  legacyOperatorAuthorization,
  operatorAuthorization,
  prefixedKv,
  type OperatorEnv,
} from "./operator-auth.js";

const API_CALLER = "tomokichi-diary-api";
const OPERATOR_NEW_PREFIX = "operator-v2:";
const OPERATOR_OLD_PREFIX = "operator:";
interface ConnectionEnv extends AnalyticsEnv, OperatorEnv {}
interface ConnectionRow {
  id: string;
  issuer: "analytics" | "analytics-legacy" | "operator" | "operator-legacy";
  clientId: string;
  clientName: string;
  clientTrust: "confirmed" | "self-asserted" | "unknown";
  actorSubject: string;
  scopes: string[];
  approvedAt: string;
  expiresAt: string | null;
  redirectHost: string | null;
  lastUsedAt: string | null;
  active: boolean;
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

async function clientHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

async function allGrants(api: OAuthHelpers, userId: string) {
  const items = [] as Awaited<ReturnType<OAuthHelpers["listUserGrants"]>>["items"];
  let cursor: string | undefined;
  do {
    const page = await api.listUserGrants(userId, { limit: 100, ...(cursor ? { cursor } : {}) });
    items.push(...page.items);
    cursor = page.cursor;
  } while (cursor);
  return items;
}

export class OperatorConnections extends WorkerEntrypoint<ConnectionEnv> {
  override async fetch(request: Request): Promise<Response> {
    if ((this.ctx.props as { caller?: unknown })?.caller !== API_CALLER)
      return new Response("Forbidden", { status: 403 });
    const url = new URL(request.url);
    if (url.pathname === "/connections" && request.method === "GET") {
      const items = await this.listConnections();
      return Response.json({ items }, { headers: { "cache-control": "no-store" } });
    }
    const match =
      /^\/connections\/(analytics|analytics-legacy|operator|operator-legacy)\/([A-Za-z0-9_-]{1,80})\/revoke$/.exec(
        url.pathname,
      );
    if (match && request.method === "POST") {
      const result = await this.revoke(match[1] as ConnectionRow["issuer"], match[2]!);
      return result
        ? Response.json({ revoked: true }, { headers: { "cache-control": "no-store" } })
        : new Response("Connection not found", { status: 404 });
    }
    return new Response("Not found", { status: 404 });
  }

  private async listConnections(): Promise<ConnectionRow[]> {
    const rows: ConnectionRow[] = [];
    const sources: {
      issuer: ConnectionRow["issuer"];
      api: OAuthHelpers;
      userId: string;
    }[] = [];
    if (this.env.OPERATOR_OWNER_SUBJECT) {
      const userId = encodeURIComponent(this.env.OPERATOR_OWNER_SUBJECT);
      sources.push(
        {
          issuer: "operator",
          api: operatorAuthorization.getOAuthApi({
            ...this.env,
            OAUTH_KV: prefixedKv(this.env.OAUTH_KV, OPERATOR_NEW_PREFIX),
          }),
          userId,
        },
        {
          issuer: "operator-legacy",
          api: legacyOperatorAuthorization.getOAuthApi({
            ...this.env,
            OAUTH_KV: prefixedKv(this.env.OAUTH_KV, OPERATOR_OLD_PREFIX),
          }),
          userId,
        },
      );
    }
    if (this.env.ANALYTICS_OWNER_SUBJECT) {
      const analyticsUserId = encodeURIComponent(this.env.ANALYTICS_OWNER_SUBJECT);
      sources.push(
        {
          issuer: "analytics",
          api: analyticsOAuthHelpers(this.env),
          userId: analyticsUserId,
        },
        {
          issuer: "analytics-legacy",
          api: analyticsOAuthHelpers(this.env, true),
          userId: analyticsUserId,
        },
      );
    }
    const db = fromD1(this.env.DB);
    for (const source of sources) {
      const grants = await allGrants(source.api, source.userId);
      for (const grant of grants) {
        const metadata = object(grant.metadata);
        const name = metadata["clientName"];
        const trust = metadata["clientTrust"];
        const ref = metadata["grantRef"];
        const digest = await clientHash(grant.clientId);
        let lastUsedAt: string | null = null;
        if (typeof ref === "string") {
          const used = await db
            .prepare(
              "SELECT MAX(occurred_at) AS last_used_at FROM operator_audit_events WHERE oauth_grant_ref = ?",
            )
            .bind(ref)
            .first<{ last_used_at: string | null }>();
          lastUsedAt = used?.last_used_at ?? null;
        }
        let redirectHost =
          typeof metadata["clientRedirectHost"] === "string"
            ? metadata["clientRedirectHost"].slice(0, 253)
            : null;
        if (!redirectHost && typeof grant.redirectUri === "string") {
          try {
            redirectHost = new URL(grant.redirectUri).host;
          } catch {
            redirectHost = "local application";
          }
        }
        rows.push({
          id: grant.id,
          issuer: source.issuer,
          clientId: digest,
          clientName: typeof name === "string" && name !== "" ? name.slice(0, 120) : "unknown",
          clientTrust: trust === "confirmed" || trust === "self-asserted" ? trust : "unknown",
          actorSubject: decodeURIComponent(source.userId),
          scopes: grant.scope,
          approvedAt: new Date(grant.createdAt * 1000).toISOString(),
          expiresAt:
            typeof grant.expiresAt === "number"
              ? new Date(grant.expiresAt * 1000).toISOString()
              : null,
          redirectHost,
          lastUsedAt,
          active: grant.expiresAt === undefined || grant.expiresAt * 1000 > Date.now(),
        });
      }
    }
    return rows.toSorted((a, b) => b.approvedAt.localeCompare(a.approvedAt));
  }

  private async revoke(issuer: ConnectionRow["issuer"], grantId: string): Promise<boolean> {
    const owner = issuer.startsWith("analytics")
      ? this.env.ANALYTICS_OWNER_SUBJECT
      : this.env.OPERATOR_OWNER_SUBJECT;
    if (!owner) return false;
    const userId = encodeURIComponent(owner);
    let api: OAuthHelpers;
    switch (issuer) {
      case "analytics":
        api = analyticsOAuthHelpers(this.env);
        break;
      case "analytics-legacy":
        api = analyticsOAuthHelpers(this.env, true);
        break;
      case "operator":
        api = operatorAuthorization.getOAuthApi({
          ...this.env,
          OAUTH_KV: prefixedKv(this.env.OAUTH_KV, OPERATOR_NEW_PREFIX),
        });
        break;
      default:
        api = legacyOperatorAuthorization.getOAuthApi({
          ...this.env,
          OAUTH_KV: prefixedKv(this.env.OAUTH_KV, OPERATOR_OLD_PREFIX),
        });
    }
    const grants = await allGrants(api, userId);
    if (!grants.some((grant) => grant.id === grantId)) return false;
    await api.revokeGrant(grantId, userId);
    return true;
  }
}
