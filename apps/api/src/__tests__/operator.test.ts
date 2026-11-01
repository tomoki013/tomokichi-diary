import { describe, expect, it, vi } from "vitest";
import { createTestContext } from "@tomokichi/infra-d1/testing-context";
import { createApp } from "../app.js";
import type { Env } from "../env.js";
import { OPERATOR_ACTOR, OPERATOR_CALLER, operatorFetch } from "../operator.js";

// No ADMIN_TOKEN: the operator entrypoint must not depend on the shared secret.
const env = {} as Env;
const ctx = {} as ExecutionContext;
const request = () => new Request("https://api/v1/admin/articles");

describe("AdminOperator entrypoint", () => {
  it("refuses other callers, paths outside the admin API, and deletes before the app runs", async () => {
    const app = { fetch: vi.fn(async () => new Response("ok")) };
    const call = (url: string, method = "GET", caller: unknown = OPERATOR_CALLER) =>
      operatorFetch(new Request(url, { method }), env, ctx, caller, app);
    expect((await call("https://api/v1/admin/articles", "GET", "someone-else")).status).toBe(403);
    expect((await call("https://api/v1/admin/articles", "GET", null)).status).toBe(403);
    expect((await call("https://api/v1/contact", "POST")).status).toBe(404);
    expect((await call("https://api/v1/admin", "GET")).status).toBe(404);
    expect((await call("https://api/v1/admin/tags/t1", "DELETE")).status).toBe(405);
    expect(app.fetch).not.toHaveBeenCalled();
    expect((await call("https://api/v1/admin/articles", "POST")).status).toBe(200);
  });

  it("lets the operator app through the admin gate without a token, and only that app", async () => {
    const context = await createTestContext();
    const operatorApp = createApp({ contextFactory: () => context, operatorActor: OPERATOR_ACTOR });
    const publicApp = createApp({ contextFactory: () => context });
    const allowed = await operatorFetch(request(), env, ctx, OPERATOR_CALLER, operatorApp);
    expect(allowed.status).toBe(200);
    expect((await publicApp.fetch(request(), env, ctx)).status).toBe(401);
  });
});
