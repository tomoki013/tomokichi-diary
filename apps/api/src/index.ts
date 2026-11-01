import { WorkerEntrypoint } from "cloudflare:workers";
import { createApp } from "./app.js";
import type { Env } from "./env.js";
import { operatorFetch } from "./operator.js";

const app = createApp();
export default { fetch: app.fetch };

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
