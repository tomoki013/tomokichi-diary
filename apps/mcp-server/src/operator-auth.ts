import { OAuthAuthorizationServer, OAuthResourceServer } from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp/server";
import { createOperatorClient } from "../operator/client.js";
import { createOperatorServer } from "../operator/server.js";
import { CONSENT_ORIGIN, escapeHtml, MCP_ORIGIN, ownerIdentity } from "./analytics-auth.js";

export const OPERATOR_READ = "operator:read";
export const OPERATOR_WRITE = "operator:write";
// Its own issuer, beside the analytics one: separate metadata, clients,
// grants and tokens, so neither connection can be used as the other.
export const OPERATOR_ISSUER = `${MCP_ORIGIN}/operator`;
export const OPERATOR_RESOURCE = `${MCP_ORIGIN}/operator/mcp`;
const CONSENT_PATH = "/operator-connect";
const KV_PREFIX = "operator:";

export interface OperatorEnv {
  OAUTH_KV: KVNamespace;
  /** The API's default entrypoint: only to verify the owner's Access login at consent. */
  API: { fetch(request: Request): Promise<Response> };
  /** The API's `AdminOperator` entrypoint, where the tools call `/v1/admin/*`. */
  OPERATOR_API?: { fetch(request: Request): Promise<Response> };
  /** Verified Access subject of the one person who may connect. Unset closes everything. */
  OPERATOR_OWNER_SUBJECT?: string;
}
interface OperatorProps {
  subject: string;
}

/**
 * The operator's OAuth records under their own prefix of the shared
 * namespace, so the analytics provider never reads them and the operator
 * never reads its.
 */
export function prefixedKv(kv: KVNamespace, prefix: string): KVNamespace {
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
const oauthEnv = (env: OperatorEnv): OperatorEnv => ({
  ...env,
  OAUTH_KV: prefixedKv(env.OAUTH_KV, KV_PREFIX),
});

export function authorizedOperator(
  env: OperatorEnv,
  props: unknown,
  scope: string[] | undefined,
): boolean {
  return (
    !!env.OPERATOR_OWNER_SUBJECT &&
    typeof props === "object" &&
    props !== null &&
    (props as { subject?: unknown }).subject === env.OPERATOR_OWNER_SUBJECT &&
    !!scope?.includes(OPERATOR_READ)
  );
}

export const operatorAuthorization = new OAuthAuthorizationServer<OperatorEnv>({
  issuer: OPERATOR_ISSUER,
  resources: [OPERATOR_RESOURCE],
  authorizeEndpoint: `${CONSENT_ORIGIN}${CONSENT_PATH}`,
  tokenEndpoint: `${OPERATOR_ISSUER}/oauth/token`,
  clientRegistrationEndpoint: `${OPERATOR_ISSUER}/oauth/register`,
  scopesSupported: [OPERATOR_READ, OPERATOR_WRITE, "offline_access"],
  accessTokenTTL: 3600,
  // Writes can publish to the site: the connection lapses sooner than analytics'.
  refreshTokenTTL: 30 * 86400,
  clientRegistrationTTL: 90 * 86400,
});

/**
 * The operator's tools behind the owner's grant. Without `operator:write` the
 * write tools are not even listed, and the client refuses writes regardless.
 * Calls reach the admin API over the `AdminOperator` binding; this Worker
 * holds no admin token.
 */
export const operatorResource = new OAuthResourceServer<OperatorEnv, OperatorProps>({
  resourceMetadata: {
    resource: OPERATOR_RESOURCE,
    authorization_servers: [OPERATOR_ISSUER],
    resource_name: "Tomokichi Diary Operator",
  },
  requiredScopes: [OPERATOR_READ],
  validateToken: (env) => (resource, token) =>
    operatorAuthorization.validateToken<OperatorProps>(resource, token, oauthEnv(env)),
  handler: {
    async fetch(request, env, ctx) {
      if (!authorizedOperator(env, ctx.props, ctx.auth.scope))
        return new Response("Forbidden", { status: 403 });
      if (new URL(request.url).pathname !== "/operator/mcp")
        return new Response("Not found", { status: 404 });
      const api = env.OPERATOR_API;
      if (!api) return new Response("Operator unavailable", { status: 503 });
      const writes = ctx.auth.scope.includes(OPERATOR_WRITE);
      const client = createOperatorClient(
        { apiUrl: "https://api.tomokichidiary.com", token: "", allowWrites: writes },
        (input, init) => api.fetch(new Request(input, init)),
      );
      return createMcpHandler(() => createOperatorServer(client, { readOnly: !writes }), {
        route: "/operator/mcp",
      })(request, env, ctx);
    },
  },
});

export async function operatorConsent(request: Request, env: OperatorEnv): Promise<Response> {
  const url = new URL(request.url);
  // Only the Access-protected admin proxy can serve consent.
  if (url.origin !== CONSENT_ORIGIN || url.pathname !== CONSENT_PATH)
    return new Response("Not found", { status: 404 });
  const subject = await ownerIdentity(request, env, env.OPERATOR_OWNER_SUBJECT);
  if (!subject) return new Response("Owner login required", { status: 403 });
  const oauth = operatorAuthorization.getOAuthApi(oauthEnv(env));
  if (request.method === "GET") {
    const auth = await oauth.parseAuthRequest(request);
    if (auth.scope.some((s) => ![OPERATOR_READ, OPERATOR_WRITE, "offline_access"].includes(s)))
      return new Response("Unsupported scope", { status: 400 });
    const info = await oauth.describeConsent(auth);
    const transaction = await oauth.beginConsent(auth);
    const headers = new Headers(transaction.headers);
    headers.set("content-type", "text/html; charset=utf-8");
    headers.set("cache-control", "private, no-store");
    headers.set("referrer-policy", "same-origin");
    headers.set("x-robots-tag", "noindex, nofollow");
    headers.set(
      "content-security-policy",
      `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${new URL(info.redirectUri).origin}; frame-ancestors 'none'; base-uri 'none'`,
    );
    return new Response(
      `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Diary管理操作の接続</title><style>body{font:17px/1.8 system-ui;max-width:640px;padding:32px 20px;margin:auto;color:#24313b;background:#fbfaf7}button{font:inherit;padding:10px 22px;margin:8px;border-radius:8px;border:1px solid #456}button[value=read]{background:#23443b;color:white}p{overflow-wrap:anywhere}</style><h1>非公開の管理操作を接続</h1><p>接続先（名称はクライアントの申告）: <strong>${escapeHtml(info.clientName)}</strong><br>認証後の戻り先: <strong>${escapeHtml(info.redirectHost)}</strong>${info.clientDomain ? `<br>クライアントのドメイン: ${escapeHtml(info.clientDomain)}` : ""}</p>${info.redirectIsLoopback ? "<p>ローカルアプリが戻り先です。他のローカルプロセスが受信する可能性があります。</p>" : ""}<p>読み取り（operator:read）: 記事・下書き本文・公開状態・分類・写真・広告設定を読めます。</p><p>読み書き（operator:write も）: 下書きの作成と保存、シリーズ・タグ、広告配置とA/Bテストを変更でき、公開する記事のIDや確認語を明示したときだけ公開できます。削除はできません。</p><p>接続の有効期間: 最大30日（アクセストークンは1時間）</p><form method="post" action="${CONSENT_PATH}"><input type="hidden" name="handle" value="${escapeHtml(transaction.handle)}"><button name="decision" value="read">読み取りのみ許可</button><button name="decision" value="write">読み書きを許可</button><button name="decision" value="deny">キャンセル</button></form></html>`,
      { headers },
    );
  }
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (request.headers.get("origin") !== CONSENT_ORIGIN)
    return new Response("Invalid origin", { status: 403 });
  const form = await request.formData();
  const handle = String(form.get("handle") ?? "");
  const decision = form.get("decision");
  if (decision === "deny") {
    const denied = await oauth.denyConsent(request, handle);
    const headers = new Headers(denied.headers);
    headers.set("location", denied.redirectTo);
    return new Response(null, { status: 303, headers });
  }
  if (decision !== "read" && decision !== "write")
    return new Response("Invalid decision", { status: 400 });
  const scope = decision === "write" ? [OPERATOR_READ, OPERATOR_WRITE] : [OPERATOR_READ];
  const approved = await oauth.approveConsent(request, handle, { scope });
  const completed = await oauth.completeAuthorization({
    request: approved.request,
    userId: encodeURIComponent(subject),
    scope,
    metadata: { purpose: "private-diary-operator" },
    props: { subject },
  });
  const headers = new Headers(approved.headers);
  headers.set("location", completed.redirectTo);
  headers.set("cache-control", "no-store");
  headers.set("referrer-policy", "no-referrer");
  return new Response(null, { status: 303, headers });
}

/** Whether a request belongs to the operator connection rather than analytics. */
export function isOperatorPath(pathname: string): boolean {
  return (
    pathname === CONSENT_PATH ||
    pathname.startsWith("/operator/") ||
    pathname === "/.well-known/oauth-authorization-server/operator" ||
    pathname.startsWith("/.well-known/oauth-protected-resource/operator/")
  );
}

export async function operatorFetch(
  request: Request,
  env: OperatorEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === CONSENT_PATH) {
    try {
      return await operatorConsent(request, env);
    } catch {
      return new Response("Invalid authorization request", { status: 400 });
    }
  }
  if (
    pathname === "/operator/mcp" ||
    pathname.startsWith("/operator/mcp/") ||
    pathname.startsWith("/.well-known/oauth-protected-resource/")
  )
    return operatorResource.fetch(request, env, ctx);
  return operatorAuthorization.fetch(request, oauthEnv(env), ctx);
}
