import { WorkerEntrypoint } from "cloudflare:workers";
import { createApp } from "./app.js";
import type { Env } from "./env.js";
import { operatorFetch } from "./operator.js";
import { verifyAccessJwt } from "./access.js";

const MCP_CALLER = "tomokichi-diary-mcp";

const app = createApp();
export default {
  fetch: app.fetch,
};

/** Reached only through the MCP Worker's `OPERATOR_API` binding; see operator.ts. */
export class AdminOperator extends WorkerEntrypoint<Env> {
  override fetch(request: Request): Response | Promise<Response> {
    return operatorFetch(
      request,
      this.env,
      this.ctx,
      (this.ctx.props as { caller?: unknown })?.caller,
    );
  }
}

/** Dedicated Access identity check for MCP consent, separate from admin auth. */
export class McpConsentIdentity extends WorkerEntrypoint<Env> {
  override async fetch(request: Request): Promise<Response> {
    if ((this.ctx.props as { caller?: unknown })?.caller !== MCP_CALLER)
      return new Response("Forbidden", { status: 403 });
    if (new URL(request.url).pathname !== "/mcp-consent-identity")
      return new Response("Not found", { status: 404 });
    const assertion = request.headers.get("cf-access-jwt-assertion");
    const team = this.env.ACCESS_TEAM_DOMAIN?.trim();
    const audience = this.env.MCP_CONSENT_ACCESS_AUD?.trim();
    if (!assertion || !team || !audience) return new Response("Unauthorized", { status: 401 });
    const identity = await verifyAccessJwt(assertion, team, audience);
    if (!identity) return new Response("Unauthorized", { status: 401 });
    return Response.json(
      { subject: identity.subject },
      { headers: { "cache-control": "no-store" } },
    );
  }
}
