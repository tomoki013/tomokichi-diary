import {
  getOAuthApi,
  OAuthProvider,
  type OAuthHelpers,
  type OAuthProviderOptions,
} from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp/server";
import type { D1Like } from "@tomokichi/infra-d1";
import { ANALYTICS_SCOPE, createAnalyticsServer } from "./analytics-server.js";
import { clientIdDigest, toolNameFromRequest } from "./request-context.js";
import { operationCaller } from "./tools.js";

export const MCP_ORIGIN = "https://mcp.tomokichidiary.com";
export const LEGACY_MCP_ORIGIN = "https://tomokichi-diary-mcp.tomoki-ttttt.workers.dev";
export const ANALYTICS_RESOURCE = `${MCP_ORIGIN}/analytics/mcp`;
export const LEGACY_ANALYTICS_RESOURCE = `${LEGACY_MCP_ORIGIN}/analytics/mcp`;
export const CONSENT_ORIGIN = MCP_ORIGIN;
export const LEGACY_CONSENT_ORIGIN = "https://admin.tomokichidiary.com";
export const NEW_ANALYTICS_KV_PREFIX = "analytics-v2:";
export interface AnalyticsEnv {
  DB: D1Like;
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  API: { fetch(request: Request): Promise<Response> };
  /** The API's `AdminOperator` entrypoint, where every tool runs an operation. */
  OPERATOR_API?: { fetch(request: Request): Promise<Response> };
  CONSENT_IDENTITY?: { fetch(request: Request): Promise<Response> };
  ANALYTICS_OWNER_SUBJECT?: string;
  OAUTH_REGISTRATION_LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> };
}
export function escapeHtml(text: string) {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
/** The verified Access subject of the person at the consent page, if it is `owner`. */
export async function ownerIdentity(
  request: Request,
  env: Pick<AnalyticsEnv, "API" | "CONSENT_IDENTITY">,
  owner: string | undefined,
): Promise<string | null> {
  if (!owner) return null;
  const assertion = request.headers.get("cf-access-jwt-assertion");
  if (!assertion) return null;
  const origin = new URL(request.url).origin;
  const response =
    origin === MCP_ORIGIN
      ? await env.CONSENT_IDENTITY?.fetch(
          new Request("https://internal/mcp-consent-identity", {
            headers: { "cf-access-jwt-assertion": assertion },
          }),
        )
      : origin === LEGACY_CONSENT_ORIGIN
        ? await env.API.fetch(
            new Request("https://api.tomokichidiary.com/v1/admin/analytics/connection-identity", {
              headers: { "cf-access-jwt-assertion": assertion },
            }),
          )
        : null;
  if (!response?.ok) return null;
  const { subject } = (await response.json()) as { subject?: string };
  return subject === owner ? subject : null;
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
  const legacy = url.origin === LEGACY_CONSENT_ORIGIN;
  // The new consent page is hosted on mcp.tomokichidiary.com and is separately
  // Access-protected. Keep the former admin proxy alive for existing clients.
  if ((url.origin !== CONSENT_ORIGIN && !legacy) || url.pathname !== "/analytics-connect")
    return new Response("Not found", { status: 404 });
  const subject = await ownerIdentity(request, env, env.ANALYTICS_OWNER_SUBJECT);
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
    // Native form POSTs need a non-null Origin for the strict CSRF check.
    // Cross-origin callbacks still receive no Referer.
    headers.set("referrer-policy", "same-origin");
    headers.set("x-robots-tag", "noindex, nofollow");
    headers.set(
      "content-security-policy",
      `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${new URL(info.redirectUri).origin}; frame-ancestors 'none'; base-uri 'none'`,
    );
    return new Response(
      `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Diary分析データの接続</title><style>body{font:17px/1.8 system-ui;max-width:640px;padding:32px 20px;margin:auto;color:#24313b;background:#fbfaf7}button{font:inherit;padding:10px 22px;margin:8px;border-radius:8px;border:1px solid #456}button[value=allow]{background:#23443b;color:white}p{overflow-wrap:anywhere}</style><h1>非公開の分析データを接続</h1><p>クライアント名（自己申告）: <strong>${escapeHtml(info.clientName)}</strong><br>client_id: <code>${escapeHtml(info.clientId)}</code><br>認証後の戻り先: <strong>${escapeHtml(info.redirectHost)}</strong>${info.clientDomain ? `<br>クライアントIDのドメイン: ${escapeHtml(info.clientDomain)}（アプリ名は自己申告）` : ""}</p>${info.redirectIsLoopback ? "<p>ローカルアプリが戻り先です。他のローカルプロセスが受信する可能性があります。</p>" : ""}<p>Tomokichi Diaryの流入・検索・推定収益・広告表示・読書体験の集計と週次/月次レポートを読み取れます。記事や広告の設定は変更できません。閲覧者を特定するデータや認証情報は渡しません。</p><p>読み取り許可: analytics:read<br>接続の有効期間: 最大90日（アクセストークンは1時間）</p><form method="post" action="/analytics-connect"><input type="hidden" name="handle" value="${escapeHtml(transaction.handle)}"><button name="decision" value="allow">読み取りを許可</button><button name="decision" value="deny">キャンセル</button></form></html>`,
      { headers },
    );
  }
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (request.headers.get("origin") !== url.origin)
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
  const client = await oauth.lookupClient(approved.request.clientId);
  const clientName = client?.clientName?.slice(0, 120) ?? "unknown";
  let clientRedirectHost = "unknown";
  try {
    clientRedirectHost = new URL(approved.request.redirectUri).host;
  } catch {
    clientRedirectHost = "local application";
  }
  const grantRef = crypto.randomUUID();
  const completed = await oauth.completeAuthorization({
    request: approved.request,
    userId: encodeURIComponent(subject),
    scope: [ANALYTICS_SCOPE],
    metadata: {
      purpose: "private-diary-analysis",
      clientId: approved.request.clientId,
      clientName,
      clientRedirectHost,
      clientTrust: "self-asserted",
      grantRef,
    },
    props: {
      subject,
      clientId: approved.request.clientId,
      clientName,
      clientRedirectHost,
      clientTrust: "self-asserted",
      grantRef,
    },
  });
  const headers = new Headers(approved.headers);
  headers.set("location", completed.redirectTo);
  headers.set("cache-control", "no-store");
  headers.set("referrer-policy", "no-referrer");
  return new Response(null, { status: 303, headers });
}
export function prefixedOAuthKv(kv: KVNamespace, prefix: string): KVNamespace {
  return {
    get: (key: string, options?: unknown) => kv.get(prefix + key, options as "text"),
    put: (key: string, value: string, options?: KVNamespacePutOptions) =>
      kv.put(prefix + key, value, options),
    delete: (key: string) => kv.delete(prefix + key),
    list: async (options: KVNamespaceListOptions = {}) => {
      const page = await kv.list({ ...options, prefix: prefix + (options.prefix ?? "") });
      return {
        ...page,
        keys: page.keys.map((key) => ({ ...key, name: key.name.slice(prefix.length) })),
      };
    },
  } as unknown as KVNamespace;
}

export function analyticsOAuthEnv(env: AnalyticsEnv): AnalyticsEnv {
  return { ...env, OAUTH_KV: prefixedOAuthKv(env.OAUTH_KV, NEW_ANALYTICS_KV_PREFIX) };
}

function createAnalyticsOptions(
  origin: string,
  resource: string,
  consentOrigin: string,
): OAuthProviderOptions<AnalyticsEnv> {
  return {
    apiRoute: "/analytics/mcp",
    apiHandler: {
      async fetch(request, env, ctx) {
        const auth = (ctx as unknown as { auth?: { scope: string[]; clientId?: string } }).auth;
        if (!authorizedOwner(env, ctx.props, auth?.scope))
          return new Response("Forbidden", { status: 403 });
        if (new URL(request.url).pathname !== "/analytics/mcp")
          return new Response("Not found", { status: 404 });
        const props = ctx.props as Record<string, unknown>;
        const api = env.OPERATOR_API;
        if (!api) return new Response("Analytics unavailable", { status: 503 });
        const text = (key: string) => (typeof props[key] === "string" ? props[key] : undefined);
        const trust = props["clientTrust"];
        const clientId = auth?.clientId ?? text("clientId");
        const toolName = await toolNameFromRequest(request);
        // The API records the call and refuses anything but analytics reads.
        const auditContext = {
          actorType: "remote-analytics",
          actorSubject: text("subject") ?? "unknown",
          clientId: clientId ? await clientIdDigest(clientId) : undefined,
          clientName: text("clientName"),
          clientRedirectHost: text("clientRedirectHost"),
          clientTrust: trust === "confirmed" || trust === "self-asserted" ? trust : "unknown",
          oauthGrantRef: text("grantRef"),
          operatorWrite: false,
          ...(toolName ? { mcpToolName: toolName } : {}),
        };
        const call = operationCaller((req) => api.fetch(req), "https://api.tomokichidiary.com", {
          "x-request-id": crypto.randomUUID(),
          "x-operator-audit-context": JSON.stringify(auditContext),
        });
        return createMcpHandler(() => createAnalyticsServer(call), {
          route: "/analytics/mcp",
        })(request, env, ctx);
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
    authorizeEndpoint: `${consentOrigin}/analytics-connect`,
    tokenEndpoint: `${origin}/analytics/oauth/token`,
    clientRegistrationEndpoint: `${origin}/analytics/oauth/register`,
    scopesSupported: [ANALYTICS_SCOPE, "offline_access"],
    requiredScopes: [ANALYTICS_SCOPE],
    accessTokenTTL: 3600,
    refreshTokenTTL: 90 * 86400,
    clientRegistrationTTL: 90 * 86400,
    resourceMetadata: {
      resource,
      authorization_servers: [origin],
      resource_name: "Tomokichi Diary Private Analytics",
    },
  };
}

/** New issuer and KV namespace prefix. Existing workers.dev grants remain valid only there. */
const newAnalyticsOptions = createAnalyticsOptions(MCP_ORIGIN, ANALYTICS_RESOURCE, CONSENT_ORIGIN);
const legacyAnalyticsOptions = createAnalyticsOptions(
  LEGACY_MCP_ORIGIN,
  LEGACY_ANALYTICS_RESOURCE,
  LEGACY_CONSENT_ORIGIN,
);
export const analyticsOAuth = new OAuthProvider<AnalyticsEnv>(newAnalyticsOptions);
export const legacyAnalyticsOAuth = new OAuthProvider<AnalyticsEnv>(legacyAnalyticsOptions);

export function analyticsOAuthHelpers(env: AnalyticsEnv, legacy = false): OAuthHelpers {
  const selected = legacy ? legacyAnalyticsOptions : newAnalyticsOptions;
  return getOAuthApi(selected, legacy ? env : analyticsOAuthEnv(env));
}
