import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fromNodeSqlite, openInMemoryDatabase } from "@tomokichi/infra-d1/testing";
import type { D1Like } from "@tomokichi/infra-d1";
import { createTestContext } from "@tomokichi/infra-d1/testing-context";
import { createApp } from "../app.js";
import type { Env } from "../env.js";

const TOKEN = "connections-admin-token";
const CLIENT_HASH = "a1b2c3d4e5f60718293a4b5c6d7e8f90";

function database() {
  const raw = openInMemoryDatabase();
  const auditDb = fromNodeSqlite(raw);
  const d1 = {
    prepare(query: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...bound: unknown[]) {
          values = bound;
          return statement;
        },
        async all() {
          return { results: raw.prepare(query).all(...(values as never[])) };
        },
        async first() {
          return raw.prepare(query).get(...(values as never[])) ?? null;
        },
        async run() {
          return raw.prepare(query).run(...(values as never[]));
        },
      };
      return statement;
    },
    async batch() {
      throw new Error("batch is not used by this test");
    },
    async exec(query: string) {
      raw.exec(query);
    },
  } as unknown as D1Like;
  return { auditDb, d1 };
}

describe("admin MCP connection routes", () => {
  it("confirms names against client hash and redirect host, and revokes through the private binding", async () => {
    const context = await createTestContext();
    const { auditDb, d1 } = database();
    await auditDb.exec(readFileSync("migrations/0025_operator_audit_events.sql", "utf8"));
    const bindingCalls: string[] = [];
    const env = {
      ADMIN_TOKEN: TOKEN,
      DB: d1,
      MCP_CONNECTIONS: {
        async fetch(request: Request) {
          const url = new URL(request.url);
          bindingCalls.push(`${request.method} ${url.pathname}`);
          if (url.pathname === "/connections" && request.method === "GET")
            return Response.json({
              items: [
                {
                  id: "grant_123",
                  issuer: "operator",
                  clientId: CLIENT_HASH,
                  clientName: "Muse",
                  clientTrust: "self-asserted",
                  actorSubject: "owner-subject",
                  scopes: ["operator:read"],
                  approvedAt: "2026-11-01T00:00:00.000Z",
                  expiresAt: "2026-12-01T00:00:00.000Z",
                  redirectHost: "chatgpt.com",
                  lastUsedAt: null,
                  active: true,
                },
              ],
            });
          if (url.pathname === "/connections/operator/grant_123/revoke")
            return Response.json({ revoked: true });
          return new Response("Not found", { status: 404 });
        },
      },
    } as unknown as Env;
    const app = createApp({ contextFactory: () => context, auditDb });
    const headers = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
    const unauthenticated = await app.request("/v1/admin/connections", {}, env);
    expect(unauthenticated.status).toBe(401);

    const saved = await app.request(
      `/v1/admin/connections/clients/${CLIENT_HASH}/label`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ redirectHost: "chatgpt.com", displayName: "Muse" }),
      },
      env,
    );
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ clientTrust: "confirmed", displayName: "Muse" });

    const listed = await app.request("/v1/admin/connections", { headers }, env);
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({
      items: [{ clientName: "Muse", clientTrust: "confirmed", actorSubject: "owner-subject" }],
    });

    const revoked = await app.request(
      "/v1/admin/connections/operator/grant_123/revoke",
      { method: "POST", headers, body: JSON.stringify({ confirm: "revoke" }) },
      env,
    );
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toEqual({ revoked: true });
    expect(bindingCalls).toContain("GET /connections");
    expect(bindingCalls).toContain("POST /connections/operator/grant_123/revoke");
    const events = await auditDb
      .prepare("SELECT action,result,target_id FROM operator_audit_events ORDER BY occurred_at")
      .all<Record<string, unknown>>();
    expect(events).toHaveLength(2);
    expect(events.map((event) => event["result"])).toEqual(["succeeded", "succeeded"]);
  });
});
