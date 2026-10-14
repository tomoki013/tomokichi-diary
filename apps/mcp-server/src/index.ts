import { createMcpHandler } from "agents/mcp/server";
import { analyticsOAuth, type AnalyticsEnv } from "./analytics-auth.js";
import { createServer } from "./server.js";
import evidenceAppHtml from "../ui-dist/index.html";

interface Env extends AnalyticsEnv {
  SITE_ORIGIN: string;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/analytics/oauth/register" && request.method === "POST") {
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
    if (
      url.pathname.startsWith("/analytics/") ||
      url.pathname === "/analytics-connect" ||
      url.pathname.startsWith("/.well-known/oauth-")
    ) {
      return Promise.resolve(analyticsOAuth.fetch(request, env, ctx)).then((response) => {
        const headers = new Headers(response.headers);
        headers.set("cache-control", "private, no-store");
        headers.set("x-robots-tag", "noindex, nofollow");
        return new Response(response.body, { status: response.status, headers });
      });
    }
    if (url.pathname !== "/mcp") return new Response("Not found", { status: 404 });
    return createMcpHandler(() => createServer(env.SITE_ORIGIN, evidenceAppHtml))(
      request,
      env,
      ctx,
    );
  },
};
