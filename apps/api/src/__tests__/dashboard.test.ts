import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openInMemoryDatabase } from "@tomokichi/infra-d1/testing";
import type { D1Like } from "@tomokichi/infra-d1";
import { createTestContext } from "@tomokichi/infra-d1/testing-context";
import { createApp } from "../app.js";
import type { Env } from "../env.js";

const TOKEN = "dashboard-test-token";
const headers = {
  authorization: `Bearer ${TOKEN}`,
  "content-type": "application/json",
};

async function fixture() {
  const raw = openInMemoryDatabase();
  raw.exec(`
    CREATE TABLE articles (id TEXT PRIMARY KEY, kind TEXT NOT NULL);
    CREATE TABLE collections (id TEXT PRIMARY KEY, kind TEXT NOT NULL);
  `);
  raw.exec(readFileSync("migrations/0026_dashboard_tasks_and_ideas.sql", "utf8"));
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
      throw new Error("batch is not used by dashboard routes");
    },
    async exec(query: string) {
      raw.exec(query);
    },
  } as unknown as D1Like;
  const context = await createTestContext();
  const app = createApp({ contextFactory: () => context });
  const env = { ADMIN_TOKEN: TOKEN, DB: d1 } as unknown as Env;
  return { app, env, raw };
}

describe("admin dashboard persistence", () => {
  it("keeps tasks private, deduplicates recommendations, and persists their status", async () => {
    const { app, env } = await fixture();
    expect((await app.request("/v1/admin/dashboard/tasks", {}, env)).status).toBe(401);

    const input = {
      title: "検索CTRを見直す",
      kind: "seo",
      priority: "P1",
      source: "recommendation",
      details: "表示が多くCTRが低下",
      articleId: null,
      causeKey: "rewrite:article-1:analytics-review",
      evidenceStart: "2026-10-01",
      evidenceEnd: "2026-10-28",
      rule: "表示300以上・CTRが1pp以上低下",
    };
    const created = await app.request(
      "/v1/admin/dashboard/tasks",
      { method: "POST", headers, body: JSON.stringify(input) },
      env,
    );
    expect(created.status).toBe(201);
    expect(created.headers.get("cache-control")).toBe("private, no-store");
    const item = (await created.json()) as {
      item: { id: string; status: string };
      created: boolean;
    };
    expect(item).toMatchObject({ created: true, item: { status: "todo" } });

    const duplicate = await app.request(
      "/v1/admin/dashboard/tasks",
      { method: "POST", headers, body: JSON.stringify(input) },
      env,
    );
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({ created: false, item: { id: item.item.id } });

    const updated = await app.request(
      `/v1/admin/dashboard/tasks/${item.item.id}`,
      { method: "PATCH", headers, body: JSON.stringify({ status: "done" }) },
      env,
    );
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ item: { status: "done" } });
    const listed = await app.request("/v1/admin/dashboard/tasks", { headers }, env);
    expect(await listed.json()).toMatchObject({ items: [{ id: item.item.id, status: "done" }] });
  });

  it("links an idea to one matching draft and rejects duplicate article links", async () => {
    const { app, env, raw } = await fixture();
    const ideaInput = {
      provisionalTitle: "バンコクの企画",
      articleKind: "article",
      seriesId: null,
      summary: "現地で見たことを書く",
      priority: "P2",
      status: "planning",
      relatedArticleId: null,
      linkedArticleId: null,
    };
    const created = await app.request(
      "/v1/admin/dashboard/ideas",
      { method: "POST", headers, body: JSON.stringify(ideaInput) },
      env,
    );
    expect(created.status).toBe(201);
    const idea = (await created.json()) as { item: { id: string } };
    raw.prepare("INSERT INTO articles (id, kind) VALUES (?, ?)").run("draft-1", "article");

    const linked = await app.request(
      `/v1/admin/dashboard/ideas/${idea.item.id}`,
      {
        method: "PUT",
        headers,
        body: JSON.stringify({ ...ideaInput, status: "drafting", linkedArticleId: "draft-1" }),
      },
      env,
    );
    expect(linked.status).toBe(200);
    expect(await linked.json()).toMatchObject({
      item: { linkedArticleId: "draft-1", status: "drafting" },
    });

    const second = await app.request(
      "/v1/admin/dashboard/ideas",
      {
        method: "POST",
        headers,
        body: JSON.stringify({ ...ideaInput, linkedArticleId: "draft-1" }),
      },
      env,
    );
    expect(second.status).toBe(409);
  });
});
