import { createProjectOperatorClient, type ProjectOperatorClient } from "@inquiry-platform/sdk";
import type { Env } from "./env.js";
import { INQUIRY_PROJECT_SLUG } from "./inquiry.js";

/**
 * This site's tickets on the shared inquiry platform, as its admin works them.
 *
 * The platform's `ProjectOperator` entrypoint, over a Service Binding: which
 * project this Worker may operate is fixed in the binding's `props`
 * (`cloudflare.config.ts`), and the platform answers every other project's ticket as
 * if it did not exist. Nothing is configured on the platform's API gateway or
 * its Access application; who may use this is decided by this site's own admin
 * gate, which runs before any route that reaches here.
 */
export function createInquiryOperator(env: Env): ProjectOperatorClient | null {
  return env.INQUIRY_OPERATOR
    ? createProjectOperatorClient(env.INQUIRY_OPERATOR, INQUIRY_PROJECT_SLUG)
    : null;
}
