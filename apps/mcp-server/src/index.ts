import { createMcpHandler } from "agents/mcp/server";
import {
  analyticsOAuth,
  analyticsOAuthEnv,
  MCP_ORIGIN,
  type AnalyticsEnv,
} from "./analytics-auth.js";
import { isOperatorPath, operatorFetch, type OperatorEnv } from "./operator-auth.js";
import { createServer } from "./server.js";
import evidenceAppHtml from "../ui-dist/index.html";

const WORKERS_DEV_ORIGIN = "https://tomokichi-diary-mcp.tomoki-ttttt.workers.dev";
export { OperatorConnections } from "./connections.js";

const privateHeaders = (response: Response) => {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "private, no-store");
  headers.set("x-robots-tag", "noindex, nofollow");
  return new Response(response.body, { status: response.status, headers });
};

interface Env extends AnalyticsEnv, OperatorEnv {
  SITE_ORIGIN: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    // Private connections (OAuth, consent, analytics, operator) answer only on
    // mcp.tomokichidiary.com; the old workers.dev issuers and the admin consent
    // proxy were retired on 2026-11-27. workers.dev keeps the public /mcp only.
    const publicOnly = url.origin === WORKERS_DEV_ORIGIN;
    if (url.origin !== MCP_ORIGIN && !publicOnly) return new Response("Not found", { status: 404 });
    if (publicOnly && url.pathname !== "/mcp" && url.pathname !== "/health")
      return new Response("Not found", { status: 404 });
    if (
      (url.pathname === "/analytics/oauth/register" ||
        url.pathname === "/operator/oauth/register") &&
      request.method === "POST"
    ) {
      if (!env.OAUTH_REGISTRATION_LIMITER) return new Response("Unavailable", { status: 503 });
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(request.headers.get("cf-connecting-ip") ?? "unknown"),
      );
      const key = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      if (!(await env.OAUTH_REGISTRATION_LIMITER.limit({ key })).success)
        return new Response("Too many registrations", {
          status: 429,
          headers: { "retry-after": "60", "cache-control": "no-store" },
        });
    }
    if (url.pathname === "/health") return Response.json({ status: "ok" });
    if (isOperatorPath(url.pathname)) return privateHeaders(await operatorFetch(request, env, ctx));
    if (
      url.pathname.startsWith("/analytics/") ||
      url.pathname === "/analytics-connect" ||
      url.pathname.startsWith("/.well-known/oauth-")
    ) {
      return privateHeaders(await analyticsOAuth.fetch(request, analyticsOAuthEnv(env), ctx));
    }
    if (url.pathname !== "/mcp") return new Response("Not found", { status: 404 });
    return createMcpHandler(() => createServer(env.SITE_ORIGIN, evidenceAppHtml))(
      request,
      env,
      ctx,
    );
  },
};
