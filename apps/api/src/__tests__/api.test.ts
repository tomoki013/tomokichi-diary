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
  const response = await request("/admin/articles", {
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
      const response = await request("/admin/articles", { headers });
      expect(response.status).toBe(401);
      expect((await response.json()).error.code).toBe("API_UNAUTHORIZED");
    }
  });

  it("closes the admin API when no token is configured", async () => {
    const response = await app.request("/admin/articles", { headers: auth }, {} as Env);
    expect(response.status).toBe(401);
  });
});

describe("validation", () => {
  it("reports every invalid field with a path", async () => {
    const response = await request("/admin/articles", {
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
    const response = await request("/admin/articles", {
      method: "POST",
      headers: auth,
      body: "not json",
    });
    expect(response.status).toBe(400);
  });
});

describe("article lifecycle", () => {
  it("creates, reads and lists an article", async () => {
    const id = await createArticle();

    const detail = await (await request(`/admin/articles/${id}`, { headers: auth })).json();
    expect(detail).toMatchObject({
      slug: "chagee-menu",
      status: "draft",
      path: "/posts/chagee-menu",
    });
    expect(detail.currentRevision.revisionNumber).toBe(1);

    const list = await (await request("/admin/articles", { headers: auth })).json();
    expect(list.items).toHaveLength(1);
  });

  it("refuses a duplicate slug with a conflict", async () => {
    await createArticle();
    const response = await request("/admin/articles", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ slug: "chagee-menu", locale: "ja", path: "/posts/other", draft }),
    });
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("API_CONFLICT");
  });

  it("returns 404 for an unknown article", async () => {
    const response = await request("/admin/articles/does-not-exist", { headers: auth });
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("ARTICLE_NOT_FOUND");
  });

  it("explains why publishing is blocked, then publishes once fixed", async () => {
    const id = await createArticle();

    const check = await (
      await request(`/admin/articles/${id}/publish-check`, { headers: auth })
    ).json();
    expect(check.publishable).toBe(false);
    expect(check.problems.map((p: { field: string }) => p.field)).toContain("media");

    const blocked = await request(`/admin/articles/${id}/publish`, {
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
      await request("/admin/media", {
        method: "POST",
        headers: { authorization: auth.authorization },
        body: upload,
      })
    ).json();

    await request(`/admin/media/article/${id}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({
        media: [
          { mediaId: uploaded.id, role: "cover", sortOrder: 0, alt: "カバー画像", caption: null },
        ],
      }),
    });

    const published = await request(`/admin/articles/${id}/publish`, {
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
      await request("/admin/media", {
        method: "POST",
        headers: { authorization: auth.authorization },
        body: upload,
      })
    ).json();
    await request(`/admin/media/article/${id}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({
        media: [
          { mediaId: uploaded.id, role: "cover", sortOrder: 0, alt: "カバー", caption: null },
        ],
      }),
    });
    await request(`/admin/articles/${id}/publish`, { method: "POST", headers: auth });

    await request(`/admin/articles/${id}/draft`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ ...draft, title: "編集後" }),
    });

    const detail = await (await request(`/admin/articles/${id}`, { headers: auth })).json();
    expect(detail.hasUnpublishedChanges).toBe(true);
    expect(detail.isLive).toBe(true);
  });
});

describe("media", () => {
  it("rejects an unsupported media type", async () => {
    const upload = new FormData();
    upload.append("file", new File([new Uint8Array([1])], "a.pdf", { type: "application/pdf" }));
    const response = await request("/admin/media", {
      method: "POST",
      headers: { authorization: auth.authorization },
      body: upload,
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("API_VALIDATION_FAILED");
  });

  it("rejects image usage without alt text", async () => {
    const id = await createArticle();
    const response = await request(`/admin/media/article/${id}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({
        media: [{ mediaId: "m", role: "cover", sortOrder: 0, alt: "", caption: null }],
      }),
    });
    expect(response.status).toBe(400);
  });
});

describe("routes", () => {
  it("resolves a path and reports a redirect after a move", async () => {
    await createArticle();

    const before = await (
      await request("/admin/routes/resolve?path=/posts/chagee-menu", { headers: auth })
    ).json();
    expect(before.kind).toBe("target");

    const moved = await request("/admin/routes/move", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ from: "/posts/chagee-menu", to: "/posts/chagee-menu-explained" }),
    });
    expect(moved.status).toBe(200);

    const after = await (
      await request("/admin/routes/resolve?path=/posts/chagee-menu", { headers: auth })
    ).json();
    expect(after).toMatchObject({
      kind: "redirect",
      destination: "/posts/chagee-menu-explained",
      status: 301,
    });

    const integrity = await (await request("/admin/routes/integrity", { headers: auth })).json();
    expect(integrity.ok).toBe(true);
  });

  it("404s an unknown path and 400s a missing parameter", async () => {
    expect((await request("/admin/routes/resolve?path=/nope", { headers: auth })).status).toBe(404);
    expect((await request("/admin/routes/resolve", { headers: auth })).status).toBe(400);
  });
});

describe("reference data", () => {
  it("returns taxonomy and locations for the editor", async () => {
    const taxonomy = await (await request("/admin/taxonomy", { headers: auth })).json();
    expect(taxonomy).toHaveProperty("categories");
    expect(taxonomy).toHaveProperty("collections");

    const locations = await (await request("/admin/locations", { headers: auth })).json();
    expect(Array.isArray(locations.items)).toBe(true);
  });
});
