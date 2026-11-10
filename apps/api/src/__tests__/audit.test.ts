import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fromNodeSqlite, openInMemoryDatabase } from "@tomokichi/infra-d1/testing";
import type { D1Like, SqlDatabase } from "@tomokichi/infra-d1";
import { createTestContext } from "@tomokichi/infra-d1/testing-context";
import { createApp } from "../app.js";
import { insertAuditEvent } from "../audit.js";
import type { Env } from "../env.js";

const TOKEN = "test-admin-token";
const env = { ADMIN_TOKEN: TOKEN } as unknown as Env;
function auditDatabase() {
  const raw = openInMemoryDatabase();
  const sql = fromNodeSqlite(raw);
  raw.exec(`
    CREATE TABLE site_publication (
      id TEXT PRIMARY KEY, requested_id TEXT, requested_at TEXT, building_id TEXT,
      deployed_id TEXT, deployed_at TEXT, failed_id TEXT, error TEXT,
      build_url TEXT, active_build_id TEXT
    );
    INSERT INTO site_publication (id) VALUES ('site');
    CREATE TABLE publication_builds (
      build_id TEXT PRIMARY KEY, request_id TEXT, state TEXT, stage TEXT, stages TEXT,
      started_at TEXT, stage_started_at TEXT, duration_ms INTEGER, error_code TEXT,
      build_url TEXT
    );
  `);
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
      throw new Error("batch is not used by audit route tests");
    },
    async exec(query: string) {
      raw.exec(query);
    },
  } as unknown as D1Like;
  return { sql, d1 };
}
const auth = {
  authorization: `Bearer ${TOKEN}`,
  "content-type": "application/json",
  "x-request-id": "forged-public-request-id",
  "x-operator-audit-context": JSON.stringify({
    actorType: "remote-operator",
    actorSubject: "forged",
    source: "remote-mcp",
    clientId: "forged-client",
    clientName: "Muse",
    clientTrust: "confirmed",
  }),
};

describe("management audit trail", () => {
  it("records mutation outcomes without storing request bodies and ignores public audit headers", async () => {
    const context = await createTestContext();
    const { sql: auditDb, d1 } = auditDatabase();
    await auditDb.exec(readFileSync("migrations/0027_operator_audit_events.sql", "utf8"));
    const app = createApp({ contextFactory: () => context, auditDb });
    const testEnv = { ...env, DB: d1 } as unknown as Env;
    const created = await app.request(
      "/v1/admin/ops/series.create",
      {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          kind: "series",
          slug: "audit-trail",
          title: "記事本文は保存しない",
          description: "この本文を監査メタデータへ入れない",
        }),
      },
      testEnv,
    );
    expect(created.status).toBe(200);
    const requestId = created.headers.get("x-request-id");
    expect(requestId).not.toBe("forged-public-request-id");
    const createdId = ((await created.json()) as { id: string }).id;

    const listed = await app.request(
      "/v1/admin/ops/activity.list",
      {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ targetType: "series", result: "succeeded", page: 1, limit: 10 }),
      },
      testEnv,
    );
    expect(listed.status, await listed.clone().text()).toBe(200);
    const body = (await listed.json()) as {
      items: {
        requestId: string;
        actorType: string;
        actorSubject: string;
        source: string;
        clientName: string | null;
        clientTrust: string;
        targetId: string;
        result: string;
        metadata: Record<string, unknown>;
      }[];
      total: number;
    };
    expect(body.total).toBe(1);
    expect(body.items[0]).toMatchObject({
      requestId,
      actorType: "admin-token",
      actorSubject: "admin-token",
      source: "admin",
      clientName: null,
      clientTrust: "unknown",
      targetId: createdId,
      result: "succeeded",
    });
    expect(JSON.stringify(body.items[0]?.metadata)).not.toContain("記事本文");

    const rejected = await app.request(
      "/v1/admin/ops/series.create",
      {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ kind: "series", slug: "Invalid Slug", title: "本文" }),
      },
      testEnv,
    );
    expect(rejected.status).toBe(400);
    const failures = await app.request(
      "/v1/admin/ops/activity.list",
      {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ result: "rejected", page: 1 }),
      },
      testEnv,
    );
    expect(
      ((await failures.json()) as { items: { result: string; statusCode: number }[] }).items[0],
    ).toMatchObject({ result: "rejected", statusCode: 400 });
  });

  it("includes the full UTC end date and rejects impossible filter dates", async () => {
    const context = await createTestContext();
    const { sql: auditDb, d1 } = auditDatabase();
    await auditDb.exec(readFileSync("migrations/0027_operator_audit_events.sql", "utf8"));
    await insertAuditEvent(auditDb, {
      id: "end-of-day-event",
      occurredAt: "2026-11-07T23:59:59.999Z",
      requestId: "end-of-day-request",
      actorType: "admin-token",
      actorSubject: "admin-token",
      source: "admin",
      clientTrust: "unknown",
      action: "article.saveDraft",
      targetType: "article",
      targetId: "end-of-day-article",
      result: "succeeded",
      statusCode: 200,
      metadata: {},
    });
    const app = createApp({ contextFactory: () => context, auditDb });
    const testEnv = { ...env, DB: d1 } as unknown as Env;
    const response = await app.request(
      "/v1/admin/ops/activity.list",
      {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ end: "2026-11-07", targetId: "end-of-day-article" }),
      },
      testEnv,
    );
    expect(response.status).toBe(200);
    expect(((await response.json()) as { total: number }).total).toBe(1);

    const invalid = await app.request(
      "/v1/admin/ops/activity.list",
      {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ end: "2026-02-30" }),
      },
      testEnv,
    );
    expect(invalid.status).toBe(400);
  });

  it("identifies the local stdio operator only through its separate bearer secret", async () => {
    const context = await createTestContext();
    const { sql: auditDb, d1 } = auditDatabase();
    await auditDb.exec(readFileSync("migrations/0027_operator_audit_events.sql", "utf8"));
    const app = createApp({ contextFactory: () => context, auditDb });
    const localEnv = {
      ...env,
      DB: d1,
      LOCAL_OPERATOR_TOKEN: "separate-local-operator-token",
    } as unknown as Env;
    const created = await app.request(
      "/v1/admin/ops/series.create",
      {
        method: "POST",
        headers: {
          authorization: "Bearer separate-local-operator-token",
          "content-type": "application/json",
          "x-operator-audit-context": JSON.stringify({
            actorType: "remote-operator",
            actorSubject: "forged",
            clientName: "Muse",
          }),
        },
        body: JSON.stringify({ kind: "series", slug: "local-audit-trail", title: "ローカル操作" }),
      },
      localEnv,
    );
    expect(created.status).toBe(200);
    // Outside the operations there is nothing for the local operator.
    const deniedAdminScreenRead = await app.request(
      "/v1/admin/media/any/file",
      { headers: { authorization: "Bearer separate-local-operator-token" } },
      localEnv,
    );
    expect(deniedAdminScreenRead.status).toBe(403);
    const activity = await app.request(
      "/v1/admin/ops/activity.list",
      {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ targetType: "series", result: "succeeded" }),
      },
      localEnv,
    );
    expect(activity.status, await activity.clone().text()).toBe(200);
    const data = (await activity.json()) as {
      items: {
        actorType: string;
        source: string;
        clientName: string | null;
        clientTrust: string;
      }[];
    };
    expect(data.items[0]).toMatchObject({
      actorType: "local-operator",
      source: "local-mcp",
      clientName: "Tomokichi Diary Local Operator",
      clientTrust: "confirmed",
    });
  });

  it("blocks a mutation when the durable audit insert fails", async () => {
    const context = await createTestContext();
    const before = await context.repos.collections.listAll();
    const failingAuditDb = {
      prepare() {
        return {
          bind() {
            return this;
          },
          async all() {
            return [];
          },
          async first() {
            return null;
          },
          async run() {
            throw new Error("D1 unavailable");
          },
        };
      },
      async batch() {},
      async exec() {},
    } as unknown as SqlDatabase;
    const app = createApp({ contextFactory: () => context, auditDb: failingAuditDb });
    const response = await app.request(
      "/v1/admin/ops/series.create",
      {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ kind: "series", slug: "audit-store-down", title: "監査停止" }),
      },
      env,
    );
    expect(response.status).toBe(503);
    expect(await context.repos.collections.listAll()).toHaveLength(before.length);
  });

  it("marks publication status reads as completed reads, not pending publications", async () => {
    const context = await createTestContext();
    const { sql: auditDb, d1 } = auditDatabase();
    await auditDb.exec(readFileSync("migrations/0027_operator_audit_events.sql", "utf8"));
    const app = createApp({
      contextFactory: () => context,
      auditDb,
      operatorActor: "operator-mcp",
      operatorAuditContext: {
        actorType: "remote-operator",
        actorSubject: "owner",
        source: "remote-mcp",
        clientTrust: "unknown",
        mcpToolName: "publication_status",
      },
    });
    const testEnv = { ...env, DB: d1 } as unknown as Env;
    const response = await app.request(
      "/v1/admin/ops/publication.status",
      { method: "POST", body: "{}" },
      testEnv,
    );
    expect(response.status).toBe(200);
    const activity = await app.request(
      "/v1/admin/ops/activity.list",
      {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ targetType: "publication", result: "succeeded" }),
      },
      testEnv,
    );
    const data = (await activity.json()) as {
      items: { action: string; mcpToolName: string; result: string }[];
    };
    expect(data.items[0]).toMatchObject({
      action: "publication.status",
      mcpToolName: "publication_status",
      result: "succeeded",
    });
  });

  it("identifies the Admin Access application from its verified audience", async () => {
    const context = await createTestContext();
    const { sql: auditDb, d1 } = auditDatabase();
    await auditDb.exec(readFileSync("migrations/0027_operator_audit_events.sql", "utf8"));
    const app = createApp({
      contextFactory: () => context,
      auditDb,
      verifyAccess: async () => ({ subject: "access-subject", email: "owner@example.com" }),
    });
    const testEnv = {
      ...env,
      DB: d1,
      ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
      ACCESS_AUD: "admin-access-audience",
    } as unknown as Env;
    const created = await app.request(
      "/v1/admin/ops/series.create",
      {
        method: "POST",
        headers: {
          "cf-access-jwt-assertion": "valid-admin-app-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ kind: "series", slug: "access-audit-trail", title: "管理画面" }),
      },
      testEnv,
    );
    expect(created.status).toBe(200);
    const activity = await app.request(
      "/v1/admin/ops/activity.list",
      {
        method: "POST",
        headers: {
          ...{ "cf-access-jwt-assertion": "valid-admin-app-token" },
          "content-type": "application/json",
        },
        body: JSON.stringify({ targetType: "series", result: "succeeded" }),
      },
      testEnv,
    );
    const data = (await activity.json()) as {
      items: { actorType: string; actorSubject: string; clientName: string; clientTrust: string }[];
    };
    expect(data.items[0]).toMatchObject({
      actorType: "access-user",
      actorSubject: "access-subject",
      clientName: "Tomokichi Diary Admin",
      clientTrust: "confirmed",
    });
  });
});
