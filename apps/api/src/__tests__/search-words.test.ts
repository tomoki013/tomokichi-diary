import { beforeEach, describe, expect, it } from "vitest";
import { createTestContext } from "@tomokichi/infra-d1/testing-context";
import { loadContentSnapshot, type AppContext } from "@tomokichi/application";
import { createApp } from "../app.js";
import type { Env } from "../env.js";

const TOKEN = "test-admin-token";
const env = { ADMIN_TOKEN: TOKEN } as unknown as Env;
const auth = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };

let ctx: AppContext;
let app: ReturnType<typeof createApp>;
const op = (name: string, input: unknown = {}) =>
  app.request(
    `/v1/admin/ops/${name}`,
    { method: "POST", headers: auth, body: JSON.stringify(input) },
    env,
  );
const items = async (response: Response) =>
  ((await response.json()) as { items: { word: string; also: string[] }[] }).items;

beforeEach(async () => {
  ctx = await createTestContext();
  app = createApp({ contextFactory: () => ctx, publishSite: async () => ({ state: "queued" }) });
});

describe("search-only words", () => {
  it("starts empty and keeps what is saved", async () => {
    expect(await items(await op("search.words"))).toEqual([]);
    const saved = await op("search.saveWords", {
      words: [
        { word: " CHAGEE ", also: ["チャジー", "霸王茶姬", "チャジー", " "] },
        { word: "Mirador del Valle", also: ["ミラドール・デル・バジェ"] },
      ],
    });
    expect(saved.status).toBe(200);
    expect(await items(await op("search.words"))).toEqual([
      { word: "CHAGEE", also: ["チャジー", "霸王茶姬"] },
      { word: "Mirador del Valle", also: ["ミラドール・デル・バジェ"] },
    ]);
  });

  it("replaces the whole list", async () => {
    await op("search.saveWords", { words: [{ word: "CHAGEE", also: ["チャジー"] }] });
    await op("search.saveWords", { words: [{ word: "KL", also: ["クアラルンプール"] }] });
    expect(await items(await op("search.words"))).toEqual([
      { word: "KL", also: ["クアラルンプール"] },
    ]);
  });

  it("refuses a spelling listed twice and a word with nothing beside it", async () => {
    const twice = await op("search.saveWords", {
      words: [
        { word: "CHAGEE", also: ["チャジー"] },
        { word: "霸王茶姬", also: ["ｃｈａｇｅｅ"] },
      ],
    });
    expect(twice.status).toBe(400);
    const empty = await op("search.saveWords", { words: [{ word: "CHAGEE", also: [" "] }] });
    expect(empty.status).toBe(400);
    expect(await items(await op("search.words"))).toEqual([]);
  });

  it("hands the words to the site build", async () => {
    await op("search.saveWords", { words: [{ word: "CHAGEE", also: ["チャジー"] }] });
    const snapshot = await loadContentSnapshot(ctx);
    expect(snapshot.searchWords?.map(({ word, also }) => ({ word, also }))).toEqual([
      { word: "CHAGEE", also: ["チャジー"] },
    ]);
  });
});
