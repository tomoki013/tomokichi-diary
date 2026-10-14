import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { createTestContext } from "@tomokichi/infra-d1/testing-context";
import { openInMemoryDatabase } from "@tomokichi/infra-d1/testing";
import { createApp } from "../app.js";
import type { Env } from "../env.js";
async function fixture() {
  const db = openInMemoryDatabase();
  db.exec(readFileSync("migrations/0015_analytics.sql", "utf8"));
  db.exec(readFileSync("migrations/0016_analytics_period_counts.sql", "utf8"));
  const DB = {
    prepare: (sql: string) => {
      let params: never[] = [];
      const statement = {
        bind: (...values: never[]) => {
          params = values;
          return statement;
        },
        all: async () => ({ results: db.prepare(sql).all(...params) }),
        first: async () => db.prepare(sql).get(...params),
        run: async () => db.prepare(sql).run(...params),
      };
      return statement;
    },
  };
  const context = await createTestContext();
  const app = createApp({
    contextFactory: () => context,
    verifyAccess: async () => ({ subject: "operator", email: "test@example.com" }),
  });
  const env = {
    DB,
    ADMIN_TOKEN: "test",
    ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com",
    ACCESS_AUD: "aud",
  } as unknown as Env;
  return { app, env };
}
afterEach(() => vi.unstubAllGlobals());
describe("private analytics HTTP boundary", () => {
  it("requires a verified Access identity rather than a shared admin token for ChatGPT consent", async () => {
    const { app, env } = await fixture();
    const path = "/v1/admin/analytics/connection-identity";
    expect(
      (await app.request(path, { headers: { authorization: "Bearer test" } }, env)).status,
    ).toBe(401);
    const res = await app.request(path, { headers: { "cf-access-jwt-assertion": "signed" } }, env);
    expect(await res.json()).toEqual({ subject: "operator" });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
  it("requires authentication; no public counterpart; Access token can read empty data without exposing secrets", async () => {
    const { app, env } = await fixture();
    const path = "/v1/admin/analytics?start=2026-10-01&end=2026-10-07";
    expect((await app.request(path, {}, env)).status).toBe(401);
    expect((await app.request("/v1/analytics", {}, env)).status).toBe(404);
    const res = await app.request(path, { headers: { "cf-access-jwt-assertion": "valid" } }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = await res.json();
    expect(body.current.every((s: { coveredDays: number }) => s.coveredDays === 0)).toBe(true);
    expect(JSON.stringify(body)).not.toContain("ADMIN_TOKEN");
  });
  it("rejects SQL injection and invalid periods before querying; unconfigured manual dispatch is explicit", async () => {
    const { app, env } = await fixture();
    const headers = { authorization: "Bearer test", "content-type": "application/json" };
    expect(
      (await app.request("/v1/admin/analytics?start=2026-02-30&end=2026-03-01", { headers }, env))
        .status,
    ).toBe(400);
    expect(
      (
        await app.request(
          "/v1/admin/analytics?start=x%27%20OR%201=1--&end=2026-03-01",
          { headers },
          env,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await app.request(
          "/v1/admin/analytics/recalculate",
          {
            method: "POST",
            headers,
            body: JSON.stringify({ start: "2026-10-01", end: "2026-10-07" }),
          },
          env,
        )
      ).status,
    ).toBe(503);
    const send = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", send);
    env.ANALYTICS_GITHUB_TOKEN = "private";
    const res = await app.request(
      "/v1/admin/analytics/recalculate",
      { method: "POST", headers, body: JSON.stringify({ start: "2026-10-01", end: "2026-10-07" }) },
      env,
    );
    expect(res.status).toBe(202);
    expect(send.mock.calls[0]?.[0]).toContain("tomoki013/tomokichi-diary");
    expect(JSON.parse(send.mock.calls[0]?.[1].body).ref).toBe("main");
    const counts = await app.request(
      "/v1/admin/analytics/counts",
      { method: "POST", headers, body: JSON.stringify({ start: "2026-08-01", end: "2026-10-01" }) },
      env,
    );
    expect(counts.status).toBe(202);
    expect(send.mock.calls[1]?.[0]).toContain("analytics-periods.yml");
  });
});
