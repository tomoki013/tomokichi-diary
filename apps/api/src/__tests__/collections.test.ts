import { beforeEach, describe, expect, it } from "vitest";
import { createTestContext } from "@tomokichi/infra-d1/testing-context";
import { loadContentSnapshot, type AppContext } from "@tomokichi/application";
import type { CollectionAdminDto } from "@tomokichi/contracts";
import { createApp } from "../app.js";
import type { Env } from "../env.js";

const TOKEN = "test-admin-token";
const env = { ADMIN_TOKEN: TOKEN } as unknown as Env;
const auth = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
const SONG = "https://music.apple.com/jp/album/sunset/1440818839?i=1440819020";

let ctx: AppContext;
let app: ReturnType<typeof createApp>;

const request = (path: string, init: RequestInit = {}) => app.request(path, init, env);
const patch = (id: string, body: unknown) =>
  request(`/v1/admin/collections/${id}`, {
    method: "PATCH",
    headers: auth,
    body: JSON.stringify(body),
  });

async function createSeries(): Promise<CollectionAdminDto> {
  const response = await request("/v1/admin/collections", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ kind: "series", slug: "sunset", title: "世界の夕陽から" }),
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
      await request(`/v1/admin/collections/${series.id}`, { headers: auth })
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
    const response = await request(`/v1/admin/collections/${series.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ themeMusic: null }),
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
    const tag = (await (
      await request("/v1/admin/tags", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ slug: "sunset-tag", name: "夕陽" }),
      })
    ).json()) as { id: string };
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
    const taxonomy = (await (await request("/v1/admin/taxonomy", { headers: auth })).json()) as {
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
