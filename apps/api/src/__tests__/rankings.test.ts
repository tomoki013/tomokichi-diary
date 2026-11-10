import { beforeEach, describe, expect, it } from "vitest";
import { createTestContext } from "@tomokichi/infra-d1/testing-context";
import { loadContentSnapshot, type AppContext } from "@tomokichi/application";
import type { RankingAdminDto } from "@tomokichi/contracts";
import { createApp } from "../app.js";
import type { Env } from "../env.js";

const TOKEN = "test-admin-token";
const env = { ADMIN_TOKEN: TOKEN } as unknown as Env;
const auth = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };

let ctx: AppContext;
let app: ReturnType<typeof createApp>;

const request = (path: string, init: RequestInit = {}) => app.request(path, init, env);
const op = (name: string, input: unknown = {}) =>
  request(`/v1/admin/ops/${name}`, { method: "POST", headers: auth, body: JSON.stringify(input) });
const patch = (id: string, body: unknown) => op("ranking.update", { rankingId: id, ...body });

async function createArticle(slug: string): Promise<string> {
  const response = await op("article.create", {
    slug,
    path: `/posts/${slug}`,
    ...{
      title: `${slug} の旅`,
      summary: "要約",
      bodyMarkdown: "本文".repeat(200),
      seoTitleOverride: null,
      seoDescriptionOverride: null,
      changeSummary: null,
    },
  });
  return ((await response.json()) as { id: string }).id;
}

async function list(): Promise<RankingAdminDto[]> {
  return (
    (await (await op("ranking.list")).json()) as {
      items: RankingAdminDto[];
    }
  ).items;
}

beforeEach(async () => {
  ctx = await createTestContext();
  app = createApp({ contextFactory: () => ctx, publishSite: async () => ({ state: "queued" }) });
});

describe("rankings", () => {
  it("starts with the seeded rankings", async () => {
    const items = await list();
    expect(items.length).toBe(24);
    expect(items[0]).toMatchObject({ title: "感動した瞬間ランキング", experienceTag: "moving" });
    // The first is seeded with the author's picks; their articles exist only in production.
    expect(items[0]!.picks).toHaveLength(11);
    expect(items[0]!.liveCount).toBe(0);
    expect(items.slice(1).every((item) => item.picks.length === 0)).toBe(true);
  });

  it("saves picks in order with their comments, naming each article", async () => {
    const [first] = await list();
    const a = await createArticle("turkey3");
    const b = await createArticle("greece2");
    const response = await patch(first!.id, {
      picks: [
        { article: a, comment: " 気球と一緒に浮かんでいた。 " },
        { article: b, comment: "" },
      ],
    });
    expect(response.status).toBe(200);
    const saved = (await response.json()) as RankingAdminDto;
    expect(saved.picks).toEqual([
      {
        articleId: a,
        comment: "気球と一緒に浮かんでいた。",
        slug: "turkey3",
        title: "turkey3 の旅",
        live: false,
      },
      { articleId: b, comment: "", slug: "greece2", title: "greece2 の旅", live: false },
    ]);
    expect(saved.liveCount).toBe(0);
  });

  it("refuses an unknown or repeated article and an over-long comment", async () => {
    const [first] = await list();
    const a = await createArticle("india1");
    expect((await patch(first!.id, { picks: [{ article: "nope" }] })).status).toBe(400);
    expect((await patch(first!.id, { picks: [{ article: a }, { article: a }] })).status).toBe(400);
    expect(
      (await patch(first!.id, { picks: [{ article: a, comment: "あ".repeat(81) }] })).status,
    ).toBe(400);
    expect((await patch(first!.id, { experienceTag: "sleepy" })).status).toBe(400);
    expect((await patch("missing", { title: "x" })).status).toBe(404);
  });

  it("creates a new ranking at the end", async () => {
    const response = await op("ranking.create", {
      title: "雨の日ランキング",
      note: "濡れても楽しい",
    });
    expect(response.status).toBe(200);
    const created = (await response.json()) as RankingAdminDto;
    const items = await list();
    expect(items.at(-1)?.id).toBe(created.id);
    expect(created).toMatchObject({ title: "雨の日ランキング", note: "濡れても楽しい", picks: [] });
  });

  it("only takes published articles into the site snapshot", async () => {
    const [first] = await list();
    const draft = await createArticle("draft-only");
    await patch(first!.id, { picks: [{ article: draft, comment: "まだ下書き" }] });
    const snapshot = await loadContentSnapshot(ctx);
    const ranking = snapshot.rankings?.find((item) => item.id === first!.id);
    expect(ranking?.picks).toEqual([]);
  });
});
