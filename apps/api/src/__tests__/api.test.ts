import { beforeEach, describe, expect, it } from "vitest";
import { createTestContext } from "@tomokichi/infra-d1/testing-context";
import type { AppContext } from "@tomokichi/application";
import { createApp } from "../app.js";
import type { Env } from "../env.js";

const TOKEN = "test-admin-token";
const env = { ADMIN_TOKEN: TOKEN } as unknown as Env;

const draft = {
  title: "CHAGEEのメニューを日本語で解説",
  summary: "実際に飲んだ4種類をまとめました。",
  bodyMarkdown: "本文".repeat(200),
  seoTitleOverride: null,
  seoDescriptionOverride: null,
  changeSummary: null,
};

let ctx: AppContext;
let app: ReturnType<typeof createApp>;

const auth = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  return app.request(path, init, env);
}

async function createArticle(overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await request("/v1/admin/articles", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      slug: "chagee-menu",
      locale: "ja",
      path: "/posts/chagee-menu",
      draft,
      ...overrides,
    }),
  });
  const body = (await response.json()) as { id: string };
  return body.id;
}

beforeEach(async () => {
  ctx = await createTestContext();
  app = createApp({ contextFactory: () => ctx });
});

describe("authentication", () => {
  it("serves health without a token", async () => {
    const response = await request("/health");
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });

  it("rejects admin requests without a valid token", async () => {
    for (const headers of [{}, { authorization: "Bearer wrong" }]) {
      const response = await request("/v1/admin/articles", { headers });
      expect(response.status).toBe(401);
      expect((await response.json()).error.code).toBe("API_UNAUTHORIZED");
    }
  });

  it("closes the admin API when no token is configured", async () => {
    const response = await app.request("/v1/admin/articles", { headers: auth }, {} as Env);
    expect(response.status).toBe(401);
  });
});

describe("validation", () => {
  it("reports every invalid field with a path", async () => {
    const response = await request("/v1/admin/articles", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ slug: "Not A Slug", locale: "fr", path: "", draft: { title: "" } }),
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("API_VALIDATION_FAILED");
    expect(body.error.issues.map((issue: { path: string }) => issue.path)).toContain("slug");
    expect(body.error.requestId).toBeTruthy();
  });

  it("rejects a body that is not an object", async () => {
    const response = await request("/v1/admin/articles", {
      method: "POST",
      headers: auth,
      body: "not json",
    });
    expect(response.status).toBe(400);
  });
});

describe("travel knowledge control plane", () => {
  it("saves and reads a validated Quick Answer for the current revision", async () => {
    const id = await createArticle();
    const detail = await (await request(`/v1/admin/articles/${id}`, { headers: auth })).json();
    const response = await request(`/v1/admin/knowledge/article/${id}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({
        article: {
          articleId: id,
          revisionId: detail.currentRevision.id,
          schemaVersion: 1,
          quickAnswer: { summary: "4種類を実飲した比較です。", recommendation: null },
          decisionTable: null,
          experienceGroups: [],
          currentFactIds: [],
          cautionFactIds: [],
          routeIds: [],
          relatedArticles: [],
        },
        facts: [],
        sources: [],
        routes: [],
      }),
    });
    expect(response.status).toBe(200);
    const stored = await (
      await request(`/v1/admin/knowledge/article/${id}`, { headers: auth })
    ).json();
    expect(stored.article.quickAnswer.summary).toContain("実飲");
    expect(stored.canSuggestWithAi).toBe(false);
  });

  it("rejects malformed knowledge before it reaches the repository", async () => {
    const id = await createArticle();
    const response = await request(`/v1/admin/knowledge/article/${id}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ article: "not-an-object" }),
    });
    expect(response.status).toBe(400);
  });
});

describe("article lifecycle", () => {
  it("creates, reads and lists an article", async () => {
    const id = await createArticle();

    const detail = await (await request(`/v1/admin/articles/${id}`, { headers: auth })).json();
    expect(detail).toMatchObject({
      slug: "chagee-menu",
      status: "draft",
      path: "/posts/chagee-menu",
    });
    expect(detail.currentRevision.revisionNumber).toBe(1);

    const list = await (await request("/v1/admin/articles", { headers: auth })).json();
    expect(list.items).toHaveLength(1);
  });

  it("refuses a duplicate slug with a conflict", async () => {
    await createArticle();
    const response = await request("/v1/admin/articles", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ slug: "chagee-menu", locale: "ja", path: "/posts/other", draft }),
    });
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("API_CONFLICT");
  });

  it("returns 404 for an unknown article", async () => {
    const response = await request("/v1/admin/articles/does-not-exist", { headers: auth });
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("ARTICLE_NOT_FOUND");
  });

  it("explains why publishing is blocked, then publishes once fixed", async () => {
    const id = await createArticle();

    const check = await (
      await request(`/v1/admin/articles/${id}/publish-check`, { headers: auth })
    ).json();
    expect(check.publishable).toBe(false);
    expect(check.problems.map((p: { field: string }) => p.field)).toContain("media");

    const blocked = await request(`/v1/admin/articles/${id}/publish`, {
      method: "POST",
      headers: auth,
    });
    expect(blocked.status).toBe(409);

    const upload = new FormData();
    upload.append(
      "file",
      new File([new Uint8Array([1, 2, 3])], "cover.jpg", { type: "image/jpeg" }),
    );
    const uploaded = await (
      await request("/v1/admin/media", {
        method: "POST",
        headers: { authorization: auth.authorization },
        body: upload,
      })
    ).json();

    await request(`/v1/admin/media/article/${id}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({
        media: [
          { mediaId: uploaded.id, role: "cover", sortOrder: 0, alt: "カバー画像", caption: null },
        ],
      }),
    });

    const published = await request(`/v1/admin/articles/${id}/publish`, {
      method: "POST",
      headers: auth,
    });
    expect(published.status).toBe(200);
    expect((await published.json()).status).toBe("published");
  });

  it("keeps a published article live while a draft moves ahead", async () => {
    const id = await createArticle();
    const upload = new FormData();
    upload.append(
      "file",
      new File([new Uint8Array([4, 5, 6])], "cover.jpg", { type: "image/jpeg" }),
    );
    const uploaded = await (
      await request("/v1/admin/media", {
        method: "POST",
        headers: { authorization: auth.authorization },
        body: upload,
      })
    ).json();
    await request(`/v1/admin/media/article/${id}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({
        media: [
          { mediaId: uploaded.id, role: "cover", sortOrder: 0, alt: "カバー", caption: null },
        ],
      }),
    });
    await request(`/v1/admin/articles/${id}/publish`, { method: "POST", headers: auth });

    await request(`/v1/admin/articles/${id}/draft`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ ...draft, title: "編集後" }),
    });

    const detail = await (await request(`/v1/admin/articles/${id}`, { headers: auth })).json();
    expect(detail.hasUnpublishedChanges).toBe(true);
    expect(detail.isLive).toBe(true);
  });
});

describe("media", () => {
  it("rejects an unsupported media type", async () => {
    const upload = new FormData();
    upload.append("file", new File([new Uint8Array([1])], "a.pdf", { type: "application/pdf" }));
    const response = await request("/v1/admin/media", {
      method: "POST",
      headers: { authorization: auth.authorization },
      body: upload,
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("API_VALIDATION_FAILED");
  });

  it("rejects image usage without alt text", async () => {
    const id = await createArticle();
    const response = await request(`/v1/admin/media/article/${id}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({
        media: [{ mediaId: "m", role: "cover", sortOrder: 0, alt: "", caption: null }],
      }),
    });
    expect(response.status).toBe(400);
  });
});

describe("article likes", () => {
  it("toggles one anonymous like and returns the shared count", async () => {
    const id = await createArticle();
    const article = await ctx.repos.articles.findById(id as never);
    if (!article) throw new Error("article setup failed");
    await ctx.repos.articles.save({
      ...article,
      status: "published",
      publishedAt: article.updatedAt,
    });

    const visitorId = "11111111-1111-4111-8111-111111111111";
    const liked = await request(`/v1/likes/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ visitorId }),
    });
    expect(liked.status).toBe(200);
    expect(await liked.json()).toEqual({ count: 1, liked: true });

    const state = await request(`/v1/likes/${id}?visitorId=${visitorId}`);
    expect(await state.json()).toEqual({ count: 1, liked: true });

    const unliked = await request(`/v1/likes/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ visitorId }),
    });
    expect(await unliked.json()).toEqual({ count: 0, liked: false });
  });
});

describe("routes", () => {
  it("resolves a path and reports a redirect after a move", async () => {
    await createArticle();

    const before = await (
      await request("/v1/admin/routes/resolve?path=/posts/chagee-menu", { headers: auth })
    ).json();
    expect(before.kind).toBe("target");

    const moved = await request("/v1/admin/routes/move", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ from: "/posts/chagee-menu", to: "/posts/chagee-menu-explained" }),
    });
    expect(moved.status).toBe(200);

    const after = await (
      await request("/v1/admin/routes/resolve?path=/posts/chagee-menu", { headers: auth })
    ).json();
    expect(after).toMatchObject({
      kind: "redirect",
      destination: "/posts/chagee-menu-explained",
      status: 301,
    });

    const integrity = await (await request("/v1/admin/routes/integrity", { headers: auth })).json();
    expect(integrity.ok).toBe(true);
  });

  it("404s an unknown path and 400s a missing parameter", async () => {
    expect((await request("/v1/admin/routes/resolve?path=/nope", { headers: auth })).status).toBe(
      404,
    );
    expect((await request("/v1/admin/routes/resolve", { headers: auth })).status).toBe(400);
  });
});

describe("reference data", () => {
  it("returns taxonomy and locations for the editor", async () => {
    const taxonomy = await (await request("/v1/admin/taxonomy", { headers: auth })).json();
    expect(taxonomy).toHaveProperty("categories");
    expect(taxonomy).toHaveProperty("collections");

    const locations = await (await request("/v1/admin/locations", { headers: auth })).json();
    expect(Array.isArray(locations.items)).toBe(true);
  });
});

describe("contact form", () => {
  const contactEnv = {
    ADMIN_TOKEN: TOKEN,
    TURNSTILE_SECRET_KEY: "secret",
    IP_HASH_SALT: "salt",
  } as unknown as Env;

  const submit = async (
    fields: Record<string, string>,
    options: { verified?: boolean; ip?: string } = {},
  ): Promise<Response> => {
    const contactApp = createApp({
      contextFactory: () => ctx,
      verifyChallenge: async () => options.verified ?? true,
    });
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    return contactApp.request(
      "/v1/contact",
      { method: "POST", body: form, headers: { "cf-connecting-ip": options.ip ?? "203.0.113.1" } },
      contactEnv,
    );
  };

  const valid = {
    name: "ともきち",
    email: "reader@example.com",
    subject: "記事の感想",
    body: "CHAGEEの記事、とても参考になりました。",
    "cf-turnstile-response": "token",
  };

  it("stores a valid submission and redirects back to the site", async () => {
    const response = await submit(valid);
    expect(response.status).toBe(303);
    expect(response.headers.get("api-version")).toBe("1");
    expect(response.headers.get("location")).toContain("/contact?sent=1");

    const stored = await ctx.repos.contactMessages.list(10);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ subject: "記事の感想", status: "unread" });
    // The address itself is never stored, only a salted hash of it.
    expect(stored[0]?.ipHash).not.toContain("203.0.113.1");
  });

  it("refuses a submission that fails the challenge", async () => {
    const response = await submit(valid, { verified: false });
    expect(response.headers.get("location")).toContain("error=challenge");
    expect(await ctx.repos.contactMessages.list(10)).toHaveLength(0);
  });

  it("refuses a submission with no challenge token at all", async () => {
    const withoutToken = { ...valid, "cf-turnstile-response": "" };
    expect((await submit(withoutToken)).headers.get("location")).toContain("error=challenge");
  });

  it("swallows a honeypot submission without storing it", async () => {
    const response = await submit({ ...valid, website: "https://spam.example" });
    // Reported as success so the bot learns nothing.
    expect(response.headers.get("location")).toContain("sent=1");
    expect(await ctx.repos.contactMessages.list(10)).toHaveLength(0);
  });

  it("reports invalid input without storing it", async () => {
    const response = await submit({ ...valid, email: "not-an-address" });
    expect(response.headers.get("location")).toContain("error=invalid");
    expect(await ctx.repos.contactMessages.list(10)).toHaveLength(0);
  });

  it("rate-limits the same sender", async () => {
    await submit(valid);
    const second = await submit({ ...valid, subject: "二通目" });
    expect(second.headers.get("location")).toContain("error=toofast");
    expect(await ctx.repos.contactMessages.list(10)).toHaveLength(1);
  });

  it("marks a link flood as spam rather than dropping it", async () => {
    await submit({ ...valid, body: "https://a.com https://b.com https://c.com https://d.com" });
    expect((await ctx.repos.contactMessages.list(10))[0]?.status).toBe("spam");
  });

  it("is closed when the challenge secret is not configured", async () => {
    const unconfigured = createApp({
      contextFactory: () => ctx,
      verifyChallenge: async () => true,
    });
    const form = new FormData();
    for (const [key, value] of Object.entries(valid)) form.append(key, value);
    const response = await unconfigured.request("/v1/contact", { method: "POST", body: form }, {
      ADMIN_TOKEN: TOKEN,
    } as Env);
    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe("API_INTERNAL");
  });

  it("lists and re-files messages in the admin", async () => {
    await submit(valid);
    const listed = await (await request("/v1/admin/messages", { headers: auth })).json();
    expect(listed.unread).toBe(1);

    const id = listed.items[0].id;
    const updated = await request(`/v1/admin/messages/${id}/status`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ status: "read" }),
    });
    expect(updated.status).toBe(200);
    expect((await (await request("/v1/admin/messages", { headers: auth })).json()).unread).toBe(0);
  });

  it("requires a token to read messages", async () => {
    expect((await request("/v1/admin/messages")).status).toBe(401);
  });
});
