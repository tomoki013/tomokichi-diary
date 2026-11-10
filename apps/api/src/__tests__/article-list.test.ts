import { beforeEach, describe, expect, it } from "vitest";
import { createTestContext } from "@tomokichi/infra-d1/testing-context";
import { fixedClock, type AppContext, type RevisionRepository } from "@tomokichi/application";
import { instantFrom } from "@tomokichi/domain";
import { createApp } from "../app.js";
import type { Env } from "../env.js";

const TOKEN = "test-admin-token";
const env = { ADMIN_TOKEN: TOKEN } as unknown as Env;
const auth = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
const body = "導入。\n\n## 見出し\n\n本文です。".repeat(20);
const draft = {
  title: "台北の朝ごはん",
  summary: "三軒食べ比べました。",
  bodyMarkdown: body,
  seoTitleOverride: null,
  seoDescriptionOverride: null,
  changeSummary: null,
};

let ctx: AppContext;
let app: ReturnType<typeof createApp>;

const op = async (name: string, input: unknown = {}) =>
  app.request(
    `/v1/admin/ops/${name}`,
    { method: "POST", headers: auth, body: JSON.stringify(input) },
    env,
  );
const at = (day: string) => {
  ctx.clock = fixedClock(instantFrom(`2026-10-${day}T00:00:00.000Z`));
};
const listed = async () =>
  (
    (await (await op("article.list")).json()) as {
      items: { id: string; title: string; contentUpdatedAt: string | null }[];
    }
  ).items;

/** An article whose reader-visible content last changed on the 5th. */
async function editedArticle(): Promise<string> {
  at("01");
  const created = (await (
    await op("article.create", {
      slug: "taipei-breakfast",
      path: "/posts/taipei-breakfast",
      ...draft,
    })
  ).json()) as { id: string };
  at("05");
  await op("article.saveDraft", { articleId: created.id, ...draft, title: "台北の朝ごはん三選" });
  at("09");
  // Only an ad marker moves: a reader sees nothing new.
  await op("article.saveDraft", {
    articleId: created.id,
    ...draft,
    title: "台北の朝ごはん三選",
    bodyMarkdown: body.replace("## 見出し", "{{monetization:prose-ad}}\n\n## 見出し"),
  });
  return created.id;
}

beforeEach(async () => {
  ctx = await createTestContext();
  app = createApp({ contextFactory: () => ctx, publishSite: async () => ({ state: "queued" }) });
});

describe("article list", () => {
  it("titles and dates each article from its revision history", async () => {
    const id = await editedArticle();
    const [item] = await listed();
    expect(item).toMatchObject({
      id,
      title: "台北の朝ごはん三選",
      contentUpdatedAt: "2026-10-05T00:00:00.000Z",
    });
  });

  it("fills in fingerprints missing from older revisions, a bounded number per read", async () => {
    await editedArticle();
    const stored = ctx.repos.revisions;
    const recorded: string[] = [];
    let unknown = true;
    const revisions: RevisionRepository = {
      ...stored,
      // As if every revision predates the column.
      listStamps: async () =>
        (await stored.listStamps()).map((stamp) =>
          unknown && !recorded.includes(stamp.id) ? { ...stamp, readerFingerprint: null } : stamp,
        ),
      recordFingerprints: async (entries) => {
        recorded.push(...entries.map((entry) => entry.id));
        await stored.recordFingerprints(entries);
      },
    };
    ctx.repos = { ...ctx.repos, revisions };

    const [item] = await listed();
    expect(recorded).toHaveLength(3);
    expect(item!.contentUpdatedAt).toBe("2026-10-05T00:00:00.000Z");

    unknown = false;
    recorded.length = 0;
    await listed();
    expect(recorded).toHaveLength(0);
  });
});
