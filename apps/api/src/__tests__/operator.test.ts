import { describe, expect, it, vi } from "vitest";
import { createTestContext } from "@tomokichi/infra-d1/testing-context";
import { createApp } from "../app.js";
import type { AuditContext } from "../audit.js";
import type { Env } from "../env.js";
import { OPERATOR_ACTOR, OPERATOR_CALLER, operatorFetch } from "../operator.js";

// No ADMIN_TOKEN: the operator entrypoint must not depend on the shared secret.
const env = {} as Env;
const ctx = {} as ExecutionContext;
const context = (fields: Record<string, unknown> = {}) =>
  JSON.stringify({
    actorType: "remote-operator",
    actorSubject: "owner",
    clientTrust: "unknown",
    operatorWrite: false,
    ...fields,
  });
const run = (name: string, input: unknown = {}, audit: string | null = context()) =>
  new Request(`https://api/v1/admin/ops/${name}`, {
    method: "POST",
    headers: audit ? { "x-operator-audit-context": audit } : {},
    body: JSON.stringify(input),
  });

describe("AdminOperator entrypoint", () => {
  it("refuses other callers, anything but an operation, and calls without a verified context", async () => {
    const app = { fetch: vi.fn(async () => new Response("ok")) };
    const call = (request: Request, caller: unknown = OPERATOR_CALLER) =>
      operatorFetch(request, env, ctx, caller, () => app);
    expect((await call(run("article.list"), "someone-else")).status).toBe(403);
    expect((await call(run("article.list"), null)).status).toBe(403);
    expect((await call(new Request("https://api/v1/contact", { method: "POST" }))).status).toBe(
      404,
    );
    expect((await call(new Request("https://api/v1/admin/media/m/file"))).status).toBe(404);
    expect((await call(new Request("https://api/v1/admin/ops/article.list"))).status).toBe(405);
    expect((await call(run("article.list", {}, null))).status).toBe(403);
    expect(app.fetch).not.toHaveBeenCalled();
    expect((await call(run("article.list"))).status).toBe(200);
  });

  it("applies the operation policy to each connection", async () => {
    const data = await createTestContext();
    const operatorApp = (operatorAuditContext: AuditContext) =>
      createApp({
        contextFactory: () => data,
        operatorActor: OPERATOR_ACTOR,
        operatorAuditContext,
      });
    const status = async (name: string, audit: string, input: unknown = {}) =>
      (await operatorFetch(run(name, input, audit), env, ctx, OPERATOR_CALLER, operatorApp)).status;

    const reader = context();
    const writer = context({ operatorWrite: true });
    const analytics = context({ actorType: "remote-analytics", operatorWrite: true });

    expect(await status("article.list", reader)).toBe(200);
    // Writes need operator:write; the analytics connection never writes.
    expect(await status("tag.create", reader, { slug: "x", name: "x" })).toBe(403);
    expect(await status("tag.create", writer, { slug: "x", name: "x" })).toBe(200);
    expect(await status("tag.create", analytics, { slug: "y", name: "y" })).toBe(403);
    // Each connection sees only its own surface.
    expect(await status("article.list", analytics)).toBe(403);
    expect(await status("analytics.savedReports", reader)).toBe(403);
    // Deletes, the inbox, fact review and revocation are the admin's alone.
    for (const name of [
      "note.delete",
      "offer.archive",
      "inquiry.tickets",
      "inquiry.status",
      "knowledge.reviewFact",
      "connection.revoke",
    ])
      expect(await status(name, writer)).toBe(403);
  });

  it("lets the operator app through the admin gate without a token, and only that app", async () => {
    const data = await createTestContext();
    const operatorApp = (operatorAuditContext: AuditContext) =>
      createApp({
        contextFactory: () => data,
        operatorActor: OPERATOR_ACTOR,
        operatorAuditContext,
      });
    const publicApp = createApp({ contextFactory: () => data });
    const allowed = await operatorFetch(
      run("article.list"),
      env,
      ctx,
      OPERATOR_CALLER,
      operatorApp,
    );
    expect(allowed.status).toBe(200);
    expect((await publicApp.fetch(run("article.list"), env, ctx)).status).toBe(401);
  });
});
