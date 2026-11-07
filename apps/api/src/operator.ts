import { createApp } from "./app.js";
import type { Env } from "./env.js";
import { parseOperatorAuditContext } from "./audit.js";
import { isAllowedOperatorRequest } from "./operator-policy.js";

/** The one Worker that may call the operator entrypoint, as its binding's props name it. */
export const OPERATOR_CALLER = "tomokichi-diary-mcp";
/** How the admin gate and its logs name a request that came this way. */
export const OPERATOR_ACTOR = "operator-mcp";

const operatorApp = createApp({ operatorActor: OPERATOR_ACTOR });

/**
 * The remote operator MCP's way into the admin API. The MCP Worker checks the
 * owner's OAuth grant and scope, then calls `/v1/admin/*` here over a Service
 * Binding, so no shared admin token has to live in that Worker. A named
 * entrypoint has no public URL; this still refuses any caller but the MCP
 * Worker, any admin route that the Operator client does not use, and all
 * writes unless its verified OAuth grant includes `operator:write`.
 */
export function operatorFetch(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  caller: unknown,
  app: {
    fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response>;
  } = operatorApp,
): Response | Promise<Response> {
  if (caller !== OPERATOR_CALLER) return new Response("Forbidden", { status: 403 });
  if (!new URL(request.url).pathname.startsWith("/v1/admin/"))
    return new Response("Not found", { status: 404 });
  if (request.method === "DELETE") return new Response("Method not allowed", { status: 405 });
  const operatorAuditContext = parseOperatorAuditContext(request);
  if (!isAllowedOperatorRequest(request, operatorAuditContext?.operatorWrite === true))
    return new Response("Forbidden", { status: 403 });
  if (app !== operatorApp) return app.fetch(request, env, ctx);
  return createApp({
    operatorActor: OPERATOR_ACTOR,
    operatorAuditContext,
  }).fetch(request, env, ctx);
}
