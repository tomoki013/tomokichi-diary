import { beforeEach, describe, expect, it } from "vitest";
import { createTestContext } from "@tomokichi/infra-d1/testing-context";
import type { AppContext } from "@tomokichi/application";
import {
  ADMIN_ONLY_OPERATIONS,
  operationNames,
  operations,
  type OperationSpec,
} from "@tomokichi/contracts";
import { createApp } from "../app.js";
import type { Env } from "../env.js";
import { handlers } from "../ops/handlers.js";

const TOKEN = "test-admin-token";
const env = { ADMIN_TOKEN: TOKEN } as unknown as Env;
const auth = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
const specs = Object.entries(operations) as [string, OperationSpec][];

const adminOnlyAllowed = (name: string) =>
  Object.keys(ADMIN_ONLY_OPERATIONS).some((pattern) =>
    pattern.endsWith(".*") ? name.startsWith(pattern.slice(0, -1)) : name === pattern,
  );

describe("the operation catalogue", () => {
  it("has a handler for every operation and no handler without one", () => {
    expect(Object.keys(handlers).toSorted()).toEqual([...operationNames].toSorted());
  });

  it("keeps everything the admin can do on an MCP surface, except the named exceptions", () => {
    const hidden = specs
      .filter(([, spec]) => spec.surface === "admin-only")
      .map(([name]) => name)
      .filter((name) => !adminOnlyAllowed(name));
    expect(hidden).toEqual([]);
    // And the exceptions really are hidden: the inbox never reaches an MCP server.
    for (const [name, spec] of specs)
      if (name.startsWith("inquiry.")) expect(spec.surface).toBe("admin-only");
  });

  it("gives every MCP operation one unique tool name and every delete none", () => {
    const tools = specs.filter(
      ([, spec]) => spec.surface !== "admin-only" && spec.kind !== "delete",
    );
    for (const [name, spec] of tools) expect(spec.tool?.name, name).toMatch(/^[a-z_]+$/);
    const names = tools.map(([, spec]) => spec.tool!.name);
    expect(new Set(names).size).toBe(names.length);
    for (const [name, spec] of specs)
      if (spec.kind === "delete") expect(spec.tool, name).toBeUndefined();
  });

  it("keeps the tool names connected clients already use", () => {
    const names = new Set(specs.map(([, spec]) => spec.tool?.name));
    for (const existing of [
      "list_articles",
      "get_article",
      "list_diary_notes",
      "get_diary_note",
      "create_diary_note_draft",
      "save_diary_note_draft",
      "check_diary_note_publishable",
      "set_diary_note_related_articles",
      "check_publishable",
      "audit_article_bodies",
      "publication_status",
      "list_taxonomy",
      "list_series",
      "search_media",
      "create_article_draft",
      "save_article_draft",
      "set_article_series_and_tags",
      "create_series",
      "update_series",
      "create_tag",
      "move_body_ad",
      "get_article_ads",
      "set_ad_layout",
      "start_ad_test",
      "list_rankings",
      "create_ranking",
      "update_ranking",
      "list_search_words",
      "save_search_words",
      "publish_site",
      "publish_article",
      "publish_diary_note",
      "unpublish_diary_note",
      "get_analytics_report",
      "get_analytics_dashboard",
    ])
      expect(names.has(existing), existing).toBe(true);
  });
});

describe("the operation route", () => {
  let ctx: AppContext;
  let app: ReturnType<typeof createApp>;
  beforeEach(async () => {
    ctx = await createTestContext();
    app = createApp({ contextFactory: () => ctx, publishSite: async () => ({ state: "queued" }) });
  });

  it("names an unknown operation and refuses malformed JSON", async () => {
    const unknown = await app.request(
      "/v1/admin/ops/article.drop",
      { method: "POST", headers: auth, body: "{}" },
      env,
    );
    expect(unknown.status).toBe(404);
    const malformed = await app.request(
      "/v1/admin/ops/article.list",
      { method: "POST", headers: auth, body: "{" },
      env,
    );
    expect(malformed.status).toBe(400);
  });

  it("treats an empty body as no input", async () => {
    const response = await app.request(
      "/v1/admin/ops/article.list",
      { method: "POST", headers: auth },
      env,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [], total: 0 });
  });
});
