import { beforeEach, describe, expect, it } from "vitest";
import { createTestContext } from "@tomokichi/infra-d1/testing-context";
import { ContentIndex, loadContentSnapshot, type AppContext } from "@tomokichi/application";
import type { CollectionAdminDto } from "@tomokichi/contracts";
import type { ArticleId, CollectionId, MediaId } from "@tomokichi/domain";
import { createApp } from "../app.js";
import type { Env } from "../env.js";

const TOKEN = "test-admin-token";
const env = { ADMIN_TOKEN: TOKEN } as unknown as Env;
const auth = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
const SONG = "https://music.apple.com/jp/album/sunset/1440818839?i=1440819020";

let ctx: AppContext;
let app: ReturnType<typeof createApp>;

const request = (path: string, init: RequestInit = {}) => app.request(path, init, env);
const op = (name: string, input: unknown = {}) =>
  request(`/v1/admin/ops/${name}`, { method: "POST", headers: auth, body: JSON.stringify(input) });
const patch = (id: string, body: unknown) => op("series.update", { collectionId: id, ...body });

async function createSeries(): Promise<CollectionAdminDto> {
  const response = await op("series.create", {
    kind: "series",
    slug: "sunset",
    title: "世界の夕陽から",
  });
  return (await response.json()) as CollectionAdminDto;
}

beforeEach(async () => {
  ctx = await createTestContext();
  app = createApp({ contextFactory: () => ctx, publishSite: async () => ({ state: "queued" }) });
});

describe("series theme music", () => {
  it("starts with no music and no defaults", async () => {
    const series = await createSeries();
    expect(series.themeMusic).toBeNull();
    expect(series.articleDefaults).toEqual({ tagIds: [], categoryIds: [], experienceTags: [] });
    expect(series.updatedAt).toBeTruthy();
  });

  it("stores a share URL in its canonical form, and keeps it when switched off", async () => {
    const series = await createSeries();
    const saved = (await (
      await patch(series.id, {
        themeMusic: { provider: "apple_music", url: SONG, title: " 夕陽の曲 ", enabled: true },
      })
    ).json()) as CollectionAdminDto;
    expect(saved.themeMusic).toEqual({
      provider: "apple_music",
      url: SONG,
      title: "夕陽の曲",
      enabled: true,
    });

    const off = (await (
      await patch(series.id, {
        themeMusic: { provider: "apple_music", url: SONG, title: "夕陽の曲", enabled: false },
      })
    ).json()) as CollectionAdminDto;
    expect(off.themeMusic).toMatchObject({ url: SONG, enabled: false });

    const removed = (await (
      await patch(series.id, { themeMusic: null })
    ).json()) as CollectionAdminDto;
    expect(removed.themeMusic).toBeNull();
  });

  it("keeps only the player URL from Apple's embed code", async () => {
    const series = await createSeries();
    const embed = `<iframe allow="autoplay *" height="175" src="https://embed.music.apple.com/jp/album/sunset/1440818839?i=1440819020" onload="alert(1)"></iframe>`;
    const saved = (await (
      await patch(series.id, { themeMusic: { provider: "apple_music", url: embed, enabled: true } })
    ).json()) as CollectionAdminDto;
    expect(saved.themeMusic?.url).toBe(SONG);
  });

  it.each([
    ["an artist page", "https://music.apple.com/jp/artist/someone/123"],
    ["another host", "https://open.spotify.com/track/abc"],
    ["a script URL", "javascript:alert(1)"],
    ["arbitrary markup", "<script>alert(1)</script>"],
  ])("rejects %s", async (_, url) => {
    const series = await createSeries();
    const response = await patch(series.id, {
      themeMusic: { provider: "apple_music", url, enabled: true },
    });
    expect(response.status).toBe(400);
    const after = (await (
      await op("series.get", { collectionId: series.id })
    ).json()) as CollectionAdminDto;
    expect(after.themeMusic).toBeNull();
  });

  it("rejects an unknown provider", async () => {
    const series = await createSeries();
    const response = await patch(series.id, {
      themeMusic: { provider: "spotify", url: SONG, enabled: true },
    });
    expect(response.status).toBe(400);
  });

  it("requires an admin", async () => {
    const series = await createSeries();
    const response = await request("/v1/admin/ops/series.update", {
      method: "POST",
      body: JSON.stringify({ collectionId: series.id, themeMusic: null }),
    });
    expect(response.status).toBe(401);
  });

  it("reaches the build only while switched on", async () => {
    const series = await createSeries();
    await patch(series.id, {
      themeMusic: { provider: "apple_music", url: SONG, title: null, enabled: false },
    });
    let snapshot = await loadContentSnapshot(ctx);
    expect(snapshot.collections.find((c) => c.id === series.id)?.themeMusic).toBeNull();

    await patch(series.id, {
      themeMusic: { provider: "apple_music", url: SONG, title: null, enabled: true },
    });
    snapshot = await loadContentSnapshot(ctx);
    expect(snapshot.collections.find((c) => c.id === series.id)?.themeMusic).toMatchObject({
      url: SONG,
      enabled: true,
    });
  });
});

describe("series article defaults", () => {
  it("saves known tags, categories and experience tags, and lists them in the taxonomy", async () => {
    const series = await createSeries();
    const tag = (await (await op("tag.create", { slug: "sunset-tag", name: "夕陽" })).json()) as {
      id: string;
    };
    const saved = (await (
      await patch(series.id, {
        articleDefaults: { tagIds: [tag.id], categoryIds: [], experienceTags: ["moving"] },
      })
    ).json()) as CollectionAdminDto;
    expect(saved.articleDefaults).toEqual({
      tagIds: [tag.id],
      categoryIds: [],
      experienceTags: ["moving"],
    });
    const taxonomy = (await (await op("taxonomy.get")).json()) as {
      collections: { id: string; articleDefaults: unknown }[];
    };
    expect(taxonomy.collections.find((c) => c.id === series.id)?.articleDefaults).toEqual(
      saved.articleDefaults,
    );
  });

  it("rejects an unknown tag or experience tag", async () => {
    const series = await createSeries();
    for (const articleDefaults of [
      { tagIds: ["missing"], categoryIds: [], experienceTags: [] },
      { tagIds: [], categoryIds: [], experienceTags: ["sad"] },
    ]) {
      expect((await patch(series.id, { articleDefaults })).status).toBe(400);
    }
  });
});

it("collects an article from its published journey metadata and preserves legacy memberships", async () => {
  async function journey(slug: string): Promise<CollectionId> {
    const response = await op("series.create", { kind: "journey", slug, title: slug });
    expect(response.status).toBe(200);
    return (await response.json()).id as CollectionId;
  }
  const first = await journey("first-trip");
  const second = await journey("second-trip");
  const series = (await createSeries()).id as CollectionId;
  const created = await op("article.create", {
    slug: "journey-story",
    path: "/posts/journey-story",
    title: "旅の話",
    summary: "旅の記録です。",
    bodyMarkdown: "旅先での出来事。".repeat(80),
  });
  expect(created.status).toBe(200);
  const articleId = (await created.json()).id as ArticleId;
  const mediaId = "journey-cover" as MediaId;
  await ctx.repos.media.save({
    id: mediaId,
    storageKey: "journey-cover.jpg",
    mimeType: "image/jpeg",
    width: 300,
    height: 200,
    size: 100,
    sha256: "b".repeat(64),
    createdAt: ctx.clock.now(),
  });
  await ctx.repos.media.replaceForArticle(articleId, [
    { articleId, mediaId, role: "cover", sortOrder: 0, alt: "旅の写真", caption: null },
  ]);
  await ctx.repos.collections.replaceForArticle(articleId, [
    { articleId, collectionId: first, sortOrder: 7 },
  ]);
  const checkedOp = async (name: string, fields: Record<string, unknown> = {}) => {
    const response = await op(name, { articleId, ...fields });
    const result = await response.json();
    expect(response.status, JSON.stringify(result)).toBe(200);
    return result;
  };
  const index = async () => new ContentIndex(await loadContentSnapshot(ctx), ctx.clock.now());
  await checkedOp("article.setRelations", { collectionIds: [series] });
  expect((await index()).membersOf(first)).toHaveLength(0);
  await checkedOp("article.publish");
  const legacy = await index();
  expect(legacy.membersOf(first).map((view) => view.article.id)).toEqual([articleId]);
  expect(legacy.snapshot.articleCollections).toContainEqual({
    articleId,
    collectionId: first,
    sortOrder: 7,
  });

  for (const invalidId of [series, "missing"]) {
    expect((await op("article.saveDraft", { articleId, journeyIds: [invalidId] })).status).toBe(
      400,
    );
  }
  await checkedOp("article.saveDraft", { journeyIds: [second, second] });
  const saved = await checkedOp("article.saveDraft", { summary: "旅の新しい要約です。" });
  expect(saved.revision.journeyIds).toEqual([second]);
  expect((await checkedOp("article.get")).collectionIds).toEqual([series, second]);
  const beforePublish = await index();
  expect(beforePublish.membersOf(first)).toHaveLength(1);
  expect(beforePublish.membersOf(second)).toHaveLength(0);

  await checkedOp("article.publish");
  const moved = await index();
  expect(moved.membersOf(first)).toHaveLength(0);
  expect(moved.membersOf(second).map((view) => view.article.id)).toEqual([articleId]);
  expect(moved.membersOf(series).map((view) => view.article.id)).toEqual([articleId]);

  await checkedOp("article.saveDraft", { journeyIds: [] });
  await checkedOp("article.publish");
  const cleared = await index();
  expect(cleared.membersOf(first)).toHaveLength(0);
  expect(cleared.membersOf(second)).toHaveLength(0);
  expect(cleared.membersOf(series)).toHaveLength(1);
});
