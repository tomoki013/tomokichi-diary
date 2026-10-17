import { beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { createTestContext } from "@tomokichi/infra-d1/testing-context";
import {
  createArticle,
  createCollection,
  publishArticle,
  setArticleMedia,
  uploadMediaWithResult,
  type AppContext,
} from "@tomokichi/application";
import type { CollectionAdminDto } from "@tomokichi/contracts";
import type { AuthorId } from "@tomokichi/domain";
import { createApp } from "../app.js";
import type { Env } from "../env.js";

const auth = { authorization: "Bearer test", "content-type": "application/json" };
const env = { ADMIN_TOKEN: "test" } as Env;
let ctx: AppContext;
let app: ReturnType<typeof createApp>;
const request = (path: string, init: RequestInit = {}) => app.request(`/v1${path}`, init, env);
const send = (method: string, path: string, body: unknown, headers: HeadersInit = auth) =>
  request(path, { method, headers, body: JSON.stringify(body) });

async function photo() {
  const body = Uint8Array.from(
    await sharp({ create: { width: 4, height: 3, channels: 4, background: "red" } })
      .png()
      .toBuffer(),
  ).buffer;
  const result = await uploadMediaWithResult(ctx, {
    body,
    originalName: "cover.png",
    mimeType: "image/png",
  });
  if (!result.ok) throw new Error("fixture failed");
  return result.value.asset;
}

beforeEach(async () => {
  ctx = await createTestContext();
  app = createApp({ contextFactory: () => ctx });
});

describe("travel soundtrack migration", () => {
  it("leaves exactly one series, both tags and one canonical URL", async () => {
    const collections = await ctx.repos.collections.listAll();
    expect(collections.filter((item) => item.slug === "travel-soundtrack")).toEqual([
      expect.objectContaining({
        kind: "series",
        title: "旅のサウンドトラック",
        description: expect.stringMatching(/^あの曲を聴くと、あの旅に戻れる。\n\n旅先で/),
      }),
    ]);
    const tags = await ctx.repos.taxonomy.listTags();
    expect(tags.filter((tag) => tag.slug === "travel-music")).toHaveLength(1);
    expect(tags.filter((tag) => tag.slug === "travel-playlist")).toHaveLength(1);
    const routes = await ctx.repos.routes.listAll();
    expect(routes.filter((route) => route.path === "/collections/travel-soundtrack")).toEqual([
      expect.objectContaining({ targetType: "series", isCanonical: true }),
    ]);
  });
});

describe("collections admin API", () => {
  it("rejects every read and write without the admin token", async () => {
    const anonymous = { "content-type": "application/json" };
    expect((await request("/admin/collections")).status).toBe(401);
    expect(
      (await send("POST", "/admin/collections", { slug: "x", title: "x" }, anonymous)).status,
    ).toBe(401);
    const [first] = await ctx.repos.collections.listAll();
    expect(
      (await send("PATCH", `/admin/collections/${first!.id}`, { title: "x" }, anonymous)).status,
    ).toBe(401);
    expect((await send("POST", "/admin/tags", { slug: "x", name: "x" }, anonymous)).status).toBe(
      401,
    );
  });

  it("lists series with their URL and an empty series counted as zero published", async () => {
    const response = await request("/admin/collections?kind=series", { headers: auth });
    expect(response.status).toBe(200);
    const { items } = (await response.json()) as { items: CollectionAdminDto[] };
    expect(items.every((item) => item.kind === "series")).toBe(true);
    expect(items.find((item) => item.slug === "travel-soundtrack")).toMatchObject({
      path: "/collections/travel-soundtrack",
      publishedCount: 0,
    });
  });

  it("creates a series with its canonical route and refuses a duplicate slug", async () => {
    const created = await send("POST", "/admin/collections", {
      slug: "night-trains",
      title: "夜行列車の旅",
      description: "寝台列車の記録",
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as CollectionAdminDto;
    expect(body).toMatchObject({ kind: "series", path: "/collections/night-trains" });
    expect(await ctx.repos.routes.findByPath("/collections/night-trains" as never)).toMatchObject({
      targetType: "series",
      targetId: body.id,
      isCanonical: true,
    });

    const again = await send("POST", "/admin/collections", {
      slug: "night-trains",
      title: "別名",
    });
    expect(again.status).toBe(409);
    const soundtrack = await send("POST", "/admin/collections", {
      slug: "travel-soundtrack",
      title: "重複",
    });
    expect(soundtrack.status).toBe(409);
    expect(
      (await ctx.repos.collections.listAll()).filter((item) => item.slug === "travel-soundtrack"),
    ).toHaveLength(1);
  });

  it("validates slug, title and cover", async () => {
    expect(
      (await send("POST", "/admin/collections", { slug: "Bad Slug", title: "x" })).status,
    ).toBe(400);
    expect((await send("POST", "/admin/collections", { slug: "ok", title: " " })).status).toBe(400);
    const missingCover = await send("POST", "/admin/collections", {
      slug: "ok",
      title: "x",
      coverMediaId: "no-such-media",
    });
    expect(missingCover.status).toBe(400);
    expect(await missingCover.json()).toMatchObject({
      error: { issues: [{ path: "coverMediaId" }] },
    });
  });

  it("edits title, description, cover and order but never the slug", async () => {
    const soundtrack = (await ctx.repos.collections.listAll()).find(
      (item) => item.slug === "travel-soundtrack",
    )!;
    const cover = await photo();
    const updated = await send("PATCH", `/admin/collections/${soundtrack.id}`, {
      title: "旅のサウンドトラック",
      description: "あの曲を聴くと、あの旅に戻れる。",
      coverMediaId: cover.id,
      sortOrder: 5,
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      coverMediaId: cover.id,
      sortOrder: 5,
      description: "あの曲を聴くと、あの旅に戻れる。",
      slug: "travel-soundtrack",
    });
    const renamed = await send("PATCH", `/admin/collections/${soundtrack.id}`, { slug: "other" });
    expect(renamed.status).toBe(400);
    expect((await ctx.repos.collections.findById(soundtrack.id))?.slug).toBe("travel-soundtrack");
    expect((await send("PATCH", "/admin/collections/missing", { title: "x" })).status).toBe(404);
  });

  it("counts only live articles as published members", async () => {
    const soundtrack = (await ctx.repos.collections.listAll()).find(
      (item) => item.slug === "travel-soundtrack",
    )!;
    const created = await createArticle(ctx, {
      slug: "airport-song",
      locale: "ja",
      authorId: "author-tomokichi" as AuthorId,
      path: "/posts/airport-song",
      draft: { title: "空港で聴いた曲", summary: "要約", bodyMarkdown: "本文。".repeat(80) },
    });
    if (!created.ok) throw new Error("fixture failed");
    const articleId = created.value.article.id;
    const saved = await send("PUT", `/admin/articles/${articleId}/relations`, {
      locations: [],
      places: [],
      categoryIds: [],
      tagIds: [],
      collectionIds: [soundtrack.id],
    });
    expect(saved.status).toBe(200);

    const read = async () =>
      (await (
        await request(`/admin/collections/${soundtrack.id}`, { headers: auth })
      ).json()) as CollectionAdminDto;
    expect(await read()).toMatchObject({ publishedCount: 0, memberCount: 1 });

    const cover = await photo();
    await setArticleMedia(ctx, articleId, [
      { articleId, mediaId: cover.id, role: "cover", sortOrder: 0, alt: "空港", caption: null },
    ]);
    const published = await publishArticle(ctx, articleId);
    expect(published.ok ? [] : published.errors).toEqual([]);
    expect(await read()).toMatchObject({ publishedCount: 1, memberCount: 1 });
  });

  it("refuses an unknown collection before writing any relation", async () => {
    const created = await createArticle(ctx, {
      slug: "relation-check",
      locale: "ja",
      authorId: "author-tomokichi" as AuthorId,
      path: "/posts/relation-check",
      draft: { title: "t", summary: "s", bodyMarkdown: "b" },
    });
    if (!created.ok) throw new Error("fixture failed");
    const [tag] = await ctx.repos.taxonomy.listTags();
    const response = await send("PUT", `/admin/articles/${created.value.article.id}/relations`, {
      locations: [],
      places: [],
      categoryIds: [],
      tagIds: [tag!.id],
      collectionIds: ["missing"],
    });
    expect(response.status).toBe(404);
    expect(
      (await ctx.repos.relations.listArticleTags()).filter(
        (row) => row.articleId === created.value.article.id,
      ),
    ).toHaveLength(0);
  });

  it("keeps a membership's stored order when the article is saved again", async () => {
    const extra = await createCollection(ctx, { kind: "series", slug: "second", title: "第二" });
    if (!extra.ok) throw new Error("fixture failed");
    const first = (await ctx.repos.collections.listAll()).find(
      (item) => item.slug === "travel-soundtrack",
    );
    const second = extra.value.collection;
    const created = await createArticle(ctx, {
      slug: "order-check",
      locale: "ja",
      authorId: "author-tomokichi" as AuthorId,
      path: "/posts/order-check",
      draft: { title: "t", summary: "s", bodyMarkdown: "b" },
    });
    if (!created.ok) throw new Error("fixture failed");
    const articleId = created.value.article.id;
    await ctx.repos.collections.replaceForArticle(articleId, [
      { articleId, collectionId: first!.id, sortOrder: 7 },
    ]);
    const response = await send("PUT", `/admin/articles/${articleId}/relations`, {
      locations: [],
      places: [],
      categoryIds: [],
      tagIds: [],
      collectionIds: [second!.id, first!.id],
    });
    expect(response.status).toBe(200);
    const after = (await ctx.repos.collections.listMemberships()).filter(
      (m) => m.articleId === articleId,
    );
    expect(after.find((m) => m.collectionId === first!.id)?.sortOrder).toBe(7);
    expect(after.find((m) => m.collectionId === second!.id)?.sortOrder).toBe(0);
  });
});

describe("tags admin API", () => {
  it("creates a tag and refuses duplicates of the soundtrack tags", async () => {
    const created = await send("POST", "/admin/tags", { slug: "night-view", name: "夜景" });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ slug: "night-view", name: "夜景" });
    expect((await send("POST", "/admin/tags", { slug: "travel-music", name: "別" })).status).toBe(
      409,
    );
    expect((await send("POST", "/admin/tags", { slug: "other", name: "旅と音楽" })).status).toBe(
      409,
    );
  });
});
