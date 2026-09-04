import { createMcpHandler } from "agents/mcp/server";
import { createServer } from "./server.js";
import evidenceAppHtml from "../ui-dist/index.html";

interface Env {
  SITE_ORIGIN: string;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ status: "ok" });
    if (url.pathname !== "/mcp") return new Response("Not found", { status: 404 });
    return createMcpHandler(() => createServer(env.SITE_ORIGIN, evidenceAppHtml))(
      request,
      env,
      ctx,
    );
  },
};
