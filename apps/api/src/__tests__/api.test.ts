import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { createTestContext } from "@tomokichi/infra-d1/testing-context";
import type { AppContext } from "@tomokichi/application";
import { loadContentSnapshot } from "@tomokichi/application";
import type { ContactMessage } from "@tomokichi/domain";
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

/** Runs one admin operation as the owner. */
async function op(name: string, input: unknown = {}): Promise<Response> {
  return request(`/v1/admin/ops/${name}`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify(input),
  });
}

async function createArticle(overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await op("article.create", {
    slug: "chagee-menu",
    path: "/posts/chagee-menu",
    ...draft,
    ...overrides,
  });
  const body = (await response.json()) as { id: string };
  return body.id;
}

beforeEach(async () => {
  ctx = await createTestContext();
  app = createApp({ contextFactory: () => ctx, publishSite: async () => ({ state: "queued" }) });
});

describe("authentication", () => {
  it("serves health without a token", async () => {
    const response = await request("/health");
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });

  it("rejects admin requests without a valid token", async () => {
    for (const headers of [{}, { authorization: "Bearer wrong" }]) {
      const response = await request("/v1/admin/ops/article.list", {
        method: "POST",
        headers,
        body: "{}",
      });
      expect(response.status).toBe(401);
      expect((await response.json()).error.code).toBe("API_UNAUTHORIZED");
    }
  });

  it("closes the admin API when no token is configured", async () => {
    const response = await app.request(
      "/v1/admin/ops/article.list",
      { method: "POST", headers: auth, body: "{}" },
      {} as Env,
    );
    expect(response.status).toBe(401);
  });
});

describe("validation", () => {
  it("reports every invalid field with a path", async () => {
    const response = await op("article.create", {
      slug: "Not A Slug",
      path: "",
      title: "",
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("API_VALIDATION_FAILED");
    expect(body.error.issues.map((issue: { path: string }) => issue.path)).toContain("slug");
    expect(body.error.requestId).toBeTruthy();
  });
});

describe("bulk publication through the authenticated article API", () => {
  it("publishes saved pages separately, rejects an incomplete article and dispatches only once", async () => {
    const publishSite = vi.fn(async (_env: Env, _deferBuild = false) => ({ state: "queued" }));
    app = createApp({ contextFactory: () => ctx, publishSite });
    const first = await createArticle({ slug: "first", kind: "page", path: "/first" });
    const second = await createArticle({ slug: "second", kind: "page", path: "/second" });
    const blocked = await createArticle({ slug: "blocked", path: "/posts/blocked" });
    const untouched = await createArticle({ slug: "untouched", kind: "page", path: "/untouched" });
    for (const id of [first, second, blocked]) {
      const response = await op("article.publish", { articleId: id, deferBuild: true });
      expect(response.status).toBe(id === blocked ? 409 : 200);
    }
    expect(publishSite.mock.calls.map((call) => call[1])).toEqual([true, true]);
    const final = await op("publication.run");
    expect(final.status).toBe(200);
    expect(publishSite.mock.calls.filter((call) => !call[1])).toHaveLength(1);
    const list = await (await op("article.list")).json();
    expect(
      list.items
        .filter((item: { isLive: boolean }) => item.isLive)
        .map((item: { id: string }) => item.id)
        .toSorted(),
    ).toEqual([first, second].toSorted());
    for (const id of [blocked, untouched]) {
      const detail = await (await op("article.get", { articleId: id })).json();
      expect(detail.publishedRevisionId).toBeNull();
    }
  });

  it("keeps the no-body publish API compatible and rejects malformed options before changing data", async () => {
    const publishSite = vi.fn(async () => ({ state: "queued" }));
    app = createApp({ contextFactory: () => ctx, publishSite });
    const id = await createArticle({ kind: "page", path: "/page" });
    for (const body of [`{"articleId":"${id}","deferBuild":"yes"}`, "{"]) {
      const response = await request("/v1/admin/ops/article.publish", {
        method: "POST",
        headers: auth,
        body,
      });
      expect(response.status).toBe(400);
    }
    expect(publishSite).not.toHaveBeenCalled();
    expect((await op("article.publish", { articleId: id })).status).toBe(200);
    expect(publishSite).toHaveBeenCalledWith(env, false);
  });

  it("requires authentication for deferred publication and the final dispatch", async () => {
    for (const name of ["article.publish", "publication.run"]) {
      const response = await request(`/v1/admin/ops/${name}`, {
        method: "POST",
        body: JSON.stringify({ articleId: "unknown", deferBuild: true }),
      });
      expect(response.status).toBe(401);
    }
  });
});

describe("diary notes", () => {
  it("keeps short note drafts separate and publishes a frozen revision with date and related articles", async () => {
    const publishSite = vi.fn(async () => ({ state: "queued" }));
    app = createApp({ contextFactory: () => ctx, publishSite });
    const created = await op("note.create", {
      slug: "santorini-memory",
      title: "テレビで見かけたサントリーニ島",
    });
    expect(created.status).toBe(200);
    const { id } = (await created.json()) as { id: string };

    const noteList = await (await op("note.list")).json();
    const articleList = await (await op("article.list")).json();
    expect(noteList.items.map((item: { id: string }) => item.id)).toEqual([id]);
    expect(articleList.items.some((item: { id: string }) => item.id === id)).toBe(false);

    const savedDraft = await op("note.saveDraft", {
      noteId: id,
      title: "テレビで見かけたサントリーニ島",
      bodyMarkdown: "自分が行った場所をテレビで見ると、なんか嬉しい。",
    });
    expect(savedDraft.status).toBe(200);
    expect((await savedDraft.json()).revision.bodyMarkdown).toContain("なんか嬉しい");

    const target = await createArticle({ slug: "note-related", path: "/posts/note-related" });
    const targetArticle = await ctx.repos.articles.findById(target as never);
    if (!targetArticle) throw new Error("related article fixture missing");
    await ctx.repos.articles.save({
      ...targetArticle,
      status: "published",
      publishedRevisionId: targetArticle.currentRevisionId,
      publishedAt: "2026-08-30T00:00:00.000Z" as never,
    });
    const related = await op("note.setRelatedArticles", {
      noteId: id,
      relatedArticleIds: [target],
    });
    expect(related.status).toBe(200);
    expect((await related.json()).relatedArticleIds).toEqual([target]);

    const date = await op("note.setDate", { noteId: id, date: "2025-06-15" });
    expect(date.status).toBe(200);
    expect((await date.json()).date).toBe("2025-06-15");

    const checked = await op("note.publishCheck", { noteId: id });
    expect(await checked.json()).toMatchObject({ publishable: true, problems: [] });
    const published = await op("note.publish", { noteId: id });
    expect(published.status).toBe(200);
    expect(publishSite).toHaveBeenCalledTimes(1);

    const live = await ctx.repos.articles.findById(id as never);
    const publicRevisionId = live?.publishedRevisionId;
    expect(live?.publishedAt).toBe("2025-06-15T00:00:00.000Z");
    const publicBeforeEdit = await loadContentSnapshot(ctx);
    expect(publicBeforeEdit.noteRelatedArticles).toEqual([
      { noteId: id, articleId: target, sortOrder: 0 },
    ]);
    expect(
      publicBeforeEdit.revisions.find((revision) => revision.id === publicRevisionId)?.bodyMarkdown,
    ).toContain("なんか嬉しい");

    await op("note.saveDraft", {
      noteId: id,
      title: "テレビで見かけたサントリーニ島",
      bodyMarkdown: "公開後に書いた下書き。",
    });
    const afterDraft = await ctx.repos.articles.findById(id as never);
    expect(afterDraft?.currentRevisionId).not.toBe(publicRevisionId);
    expect(afterDraft?.publishedRevisionId).toBe(publicRevisionId);
    const stillPublic = await loadContentSnapshot(ctx);
    expect(
      stillPublic.revisions.find((revision) => revision.id === publicRevisionId)?.bodyMarkdown,
    ).toContain("なんか嬉しい");

    const withdrawn = await op("note.unpublish", { noteId: id });
    expect(withdrawn.status).toBe(200);
    expect(publishSite).toHaveBeenCalledTimes(2);
    expect((await ctx.repos.articles.findById(id as never))?.publishedRevisionId).toBeNull();
  });

  it("requires a real calendar date and protects delete with explicit confirmation", async () => {
    const created = await op("note.create", { slug: "delete-me-note", title: "削除確認" });
    const { id } = (await created.json()) as { id: string };
    for (const date of ["2026-02-30", "20261104"]) {
      const response = await op("note.setDate", { noteId: id, date });
      expect(response.status).toBe(400);
    }
    const refused = await op("note.delete", { noteId: id, confirm: "no" });
    expect(refused.status).toBe(400);
    const deleted = await op("note.delete", { noteId: id, confirm: "delete" });
    expect(deleted.status).toBe(200);
    expect(await ctx.repos.articles.findById(id as never)).toBeNull();
  });
});

describe("travel knowledge control plane", () => {
  it("saves and reads a validated Quick Answer for the current revision", async () => {
    const id = await createArticle();
    const detail = await (await op("article.get", { articleId: id })).json();
    const response = await op("knowledge.save", {
      articleId: id,
      bundle: {
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
      },
    });
    expect(response.status).toBe(200);
    const stored = await (await op("knowledge.get", { articleId: id })).json();
    expect(stored.article.quickAnswer.summary).toContain("実飲");
  });

  it("rejects malformed knowledge before it reaches the repository", async () => {
    const id = await createArticle();
    const response = await op("knowledge.save", {
      articleId: id,
      bundle: { article: "not-an-object" },
    });
    expect(response.status).toBe(400);
  });
});

describe("article lifecycle", () => {
  it("creates, reads and lists an article", async () => {
    const id = await createArticle();

    const detail = await (await op("article.get", { articleId: id })).json();
    expect(detail).toMatchObject({
      slug: "chagee-menu",
      status: "draft",
      path: "/posts/chagee-menu",
    });
    expect(detail.currentRevision.revisionNumber).toBe(1);

    const list = await (await op("article.list")).json();
    expect(list.items).toHaveLength(1);
  });

  it("refuses a duplicate slug with a conflict", async () => {
    await createArticle();
    const response = await op("article.create", {
      slug: "chagee-menu",
      path: "/posts/other",
      ...draft,
    });
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("API_CONFLICT");
  });

  it("sets experience tags without creating a revision, and refuses unknown ones", async () => {
    const id = await createArticle();
    const put = (experienceTags: unknown) =>
      op("article.setExperienceTags", { articleId: id, experienceTags });

    const saved = await put(["moving", "exciting", "moving"]);
    expect(saved.status).toBe(200);
    // De-duplicated and in vocabulary order, whatever order the editor clicked.
    expect(await saved.json()).toEqual({ experienceTags: ["exciting", "moving"] });

    const detail = await (await op("article.get", { articleId: id })).json();
    expect(detail.experienceTags).toEqual(["exciting", "moving"]);
    expect(detail.currentRevision.revisionNumber).toBe(1);

    const rejected = await put(["sightseeing"]);
    expect(rejected.status).toBe(400);
    expect((await rejected.json()).error.code).toBe("API_VALIDATION_FAILED");
  });

  it("reports only the bodies with raw HTML or in-sentence site links", async () => {
    await createArticle({
      bodyMarkdown: `${"本文".repeat(120)}\n\n詳しくは[メニュー](./other)で。<br>\n\n[カード](./card)`,
    });
    await createArticle({ slug: "clean", path: "/posts/clean" });

    const audit = await (await op("article.bodyAudit")).json();
    expect(audit.items).toEqual([
      expect.objectContaining({
        slug: "chagee-menu",
        path: "/posts/chagee-menu",
        disallowedHtml: ["<br>"],
        inlineInternalLinks: ["./other"],
      }),
    ]);
  });

  it("returns 404 for an unknown article", async () => {
    const response = await op("article.get", { articleId: "does-not-exist" });
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("ARTICLE_NOT_FOUND");
  });

  it("explains why publishing is blocked, publishes once fixed, and stays live under a new draft", async () => {
    const id = await createArticle();

    const check = await (await op("article.publishCheck", { articleId: id })).json();
    expect(check.publishable).toBe(false);
    expect(check.problems.map((p: { field: string }) => p.field)).toContain("media");

    const blocked = await op("article.publish", { articleId: id });
    expect(blocked.status).toBe(409);

    const upload = new FormData();
    upload.append(
      "file",
      new File(
        [
          Uint8Array.from(
            await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } })
              .jpeg()
              .toBuffer(),
          ).buffer,
        ],
        "cover.jpg",
        { type: "image/jpeg" },
      ),
    );
    upload.append("slug", "cover");
    const uploaded = await (
      await request("/v1/admin/ops/media.upload", {
        method: "POST",
        headers: { authorization: auth.authorization },
        body: upload,
      })
    ).json();

    await op("article.setMedia", {
      articleId: id,
      media: [
        { mediaId: uploaded.id, role: "cover", sortOrder: 0, alt: "カバー画像", caption: null },
      ],
    });

    const published = await op("article.publish", { articleId: id });
    expect(published.status).toBe(200);
    expect((await published.json()).status).toBe("published");

    // The published revision stays live while a new draft moves ahead.
    await op("article.saveDraft", { articleId: id, ...draft, title: "編集後" });

    const detail = await (await op("article.get", { articleId: id })).json();
    expect(detail.hasUnpublishedChanges).toBe(true);
    expect(detail.isLive).toBe(true);
  });
});

describe("media", () => {
  it("rejects an unsupported media type", async () => {
    const upload = new FormData();
    upload.append("file", new File([new Uint8Array([1])], "a.pdf", { type: "application/pdf" }));
    upload.append("slug", "a");
    const response = await request("/v1/admin/ops/media.upload", {
      method: "POST",
      headers: { authorization: auth.authorization },
      body: upload,
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("API_VALIDATION_FAILED");
  });

  it("rejects image usage without alt text", async () => {
    const id = await createArticle();
    const response = await op("article.setMedia", {
      articleId: id,
      media: [{ mediaId: "m", role: "cover", sortOrder: 0, alt: "", caption: null }],
    });
    expect(response.status).toBe(400);
  });
});
