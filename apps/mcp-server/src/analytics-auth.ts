import { OAuthProvider, type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp/server";
import type { D1Like } from "@tomokichi/infra-d1";
import { ANALYTICS_SCOPE, createAnalyticsServer } from "./analytics-server.js";

export const MCP_ORIGIN = "https://tomokichi-diary-mcp.tomoki-ttttt.workers.dev";
export const ANALYTICS_RESOURCE = `${MCP_ORIGIN}/analytics/mcp`;
const CONSENT_ORIGIN = "https://admin.tomokichidiary.com";
export interface AnalyticsEnv {
  DB: D1Like;
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  API: { fetch(request: Request): Promise<Response> };
  ANALYTICS_OWNER_SUBJECT?: string;
  OAUTH_REGISTRATION_LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> };
}
export function escapeHtml(text: string) {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
export async function ownerIdentity(request: Request, env: AnalyticsEnv): Promise<string | null> {
  if (!env.ANALYTICS_OWNER_SUBJECT) return null;
  const assertion = request.headers.get("cf-access-jwt-assertion");
  if (!assertion) return null;
  const res = await env.API.fetch(
    new Request("https://api.tomokichidiary.com/v1/admin/analytics/connection-identity", {
      headers: { "cf-access-jwt-assertion": assertion },
    }),
  );
  if (!res.ok) return null;
  const { subject } = (await res.json()) as { subject?: string };
  return subject === env.ANALYTICS_OWNER_SUBJECT ? subject : null;
}
export function authorizedOwner(env: AnalyticsEnv, props: unknown, scope: string[] | undefined) {
  return (
    !!env.ANALYTICS_OWNER_SUBJECT &&
    typeof props === "object" &&
    props !== null &&
    (props as { subject?: unknown }).subject === env.ANALYTICS_OWNER_SUBJECT &&
    !!scope?.includes(ANALYTICS_SCOPE)
  );
}
export async function consent(request: Request, env: AnalyticsEnv): Promise<Response> {
  const url = new URL(request.url);
  // Only the Access-protected admin proxy can serve consent, even if someone
  // calls the public Worker with an assertion header.
  if (url.origin !== CONSENT_ORIGIN || url.pathname !== "/analytics-connect")
    return new Response("Not found", { status: 404 });
  const subject = await ownerIdentity(request, env);
  if (!subject) return new Response("Owner login required", { status: 403 });
  const oauth = env.OAUTH_PROVIDER;
  if (request.method === "GET") {
    const auth = await oauth.parseAuthRequest(request);
    if (
      auth.scope.some((scope) => ![ANALYTICS_SCOPE, "offline_access"].includes(scope)) ||
      !auth.scope.includes(ANALYTICS_SCOPE)
    )
      return new Response("Unsupported scope", { status: 400 });
    const info = await oauth.describeConsent(auth);
    const transaction = await oauth.beginConsent(auth);
    const headers = new Headers(transaction.headers);
    headers.set("content-type", "text/html; charset=utf-8");
    headers.set("cache-control", "private, no-store");
    headers.set("referrer-policy", "no-referrer");
    headers.set("x-robots-tag", "noindex, nofollow");
    headers.set(
      "content-security-policy",
      `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${new URL(info.redirectUri).origin}; frame-ancestors 'none'; base-uri 'none'`,
    );
    return new Response(
      `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Diary分析データの接続</title><style>body{font:17px/1.8 system-ui;max-width:640px;padding:32px 20px;margin:auto;color:#24313b;background:#fbfaf7}button{font:inherit;padding:10px 22px;margin:8px;border-radius:8px;border:1px solid #456}button[value=allow]{background:#23443b;color:white}p{overflow-wrap:anywhere}</style><h1>非公開の分析データを接続</h1><p>接続先（名称はクライアントの申告）: <strong>${escapeHtml(info.clientName)}</strong><br>認証後の戻り先: <strong>${escapeHtml(info.redirectHost)}</strong>${info.clientDomain ? `<br>クライアントのドメイン: ${escapeHtml(info.clientDomain)}` : ""}</p>${info.redirectIsLoopback ? "<p>ローカルアプリが戻り先です。他のローカルプロセスが受信する可能性があります。</p>" : ""}<p>Tomokichi Diaryの流入・検索・推定収益・広告表示・読書体験の集計と週次/月次レポートを読み取れます。記事や広告の設定は変更できません。閲覧者を特定するデータや認証情報は渡しません。</p><p>読み取り許可: analytics:read<br>接続の有効期間: 最大90日（アクセストークンは1時間）</p><form method="post" action="/analytics-connect"><input type="hidden" name="handle" value="${escapeHtml(transaction.handle)}"><button name="decision" value="allow">読み取りを許可</button><button name="decision" value="deny">キャンセル</button></form></html>`,
      { headers },
    );
  }
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (request.headers.get("origin") !== CONSENT_ORIGIN)
    return new Response("Invalid origin", { status: 403 });
  const form = await request.formData();
  const handle = String(form.get("handle") ?? "");
  if (form.get("decision") === "deny") {
    const denied = await oauth.denyConsent(request, handle);
    const headers = new Headers(denied.headers);
    headers.set("location", denied.redirectTo);
    return new Response(null, { status: 303, headers });
  }
  if (form.get("decision") !== "allow") return new Response("Invalid decision", { status: 400 });
  const approved = await oauth.approveConsent(request, handle, { scope: [ANALYTICS_SCOPE] });
  const completed = await oauth.completeAuthorization({
    request: approved.request,
    userId: encodeURIComponent(subject),
    scope: [ANALYTICS_SCOPE],
    metadata: { purpose: "private-diary-analysis" },
    props: { subject },
  });
  const headers = new Headers(approved.headers);
  headers.set("location", completed.redirectTo);
  headers.set("cache-control", "no-store");
  headers.set("referrer-policy", "no-referrer");
  return new Response(null, { status: 303, headers });
}
export const analyticsOAuth = new OAuthProvider<AnalyticsEnv>({
  apiRoute: "/analytics/mcp",
  apiHandler: {
    async fetch(request, env, ctx) {
      const auth = (ctx as unknown as { auth?: { scope: string[] } }).auth;
      if (!authorizedOwner(env, ctx.props, auth?.scope))
        return new Response("Forbidden", { status: 403 });
      if (new URL(request.url).pathname !== "/analytics/mcp")
        return new Response("Not found", { status: 404 });
      return createMcpHandler(() => createAnalyticsServer(env.DB), { route: "/analytics/mcp" })(
        request,
        env,
        ctx,
      );
    },
  },
  defaultHandler: {
    async fetch(request, env) {
      try {
        return await consent(request, env);
      } catch {
        return new Response("Invalid authorization request", { status: 400 });
      }
    },
  },
  authorizeEndpoint: `${CONSENT_ORIGIN}/analytics-connect`,
  tokenEndpoint: `${MCP_ORIGIN}/analytics/oauth/token`,
  clientRegistrationEndpoint: `${MCP_ORIGIN}/analytics/oauth/register`,
  scopesSupported: [ANALYTICS_SCOPE, "offline_access"],
  requiredScopes: [ANALYTICS_SCOPE],
  accessTokenTTL: 3600,
  refreshTokenTTL: 90 * 86400,
  clientRegistrationTTL: 90 * 86400,
  resourceMetadata: {
    resource: ANALYTICS_RESOURCE,
    authorization_servers: [MCP_ORIGIN],
    resource_name: "Tomokichi Diary Private Analytics",
  },
});
