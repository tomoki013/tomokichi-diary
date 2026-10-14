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
