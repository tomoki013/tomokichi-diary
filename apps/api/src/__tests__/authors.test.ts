import { beforeEach, describe, expect, it } from "vitest";
import { createTestContext } from "@tomokichi/infra-d1/testing-context";
import { createArticle, type AppContext } from "@tomokichi/application";
import type { ArticleId, AuthorId } from "@tomokichi/domain";
import { createApp } from "../app.js";
import type { Env } from "../env.js";

/*
 * The imported author's id is a UUID, not the `author-tomokichi` the API used
 * to hard-code. Revisions reference their author, so writing that constant
 * failed every draft save with a foreign-key error against real data. The
 * author now comes from the data itself.
 */

const TOKEN = "test-admin-token";
const auth = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
const IMPORTED = "ec4c0379-0ceb-8192-a7f0-33d591504335" as AuthorId;

let ctx: AppContext;

beforeEach(async () => {
  ctx = await createTestContext();
  await ctx.repos.authors.save({ id: IMPORTED, name: "ともきち", url: null, bio: null });
});

const draft = {
  title: "アブシンベルへの行き方",
  summary: "バスとツアーの比較",
  bodyMarkdown: "本文",
  seoTitleOverride: null,
  seoDescriptionOverride: null,
  changeSummary: null,
};

describe("article authorship", () => {
  it("writes a revision as the article's own author", async () => {
    const created = await createArticle(ctx, {
      slug: "abusimbel",
      locale: "ja",
      kind: "article",
      authorId: IMPORTED,
      path: "/posts/abusimbel",
      draft,
    });
    if (!created.ok) throw new Error("fixture article was not created");
    const id = created.value.article.id as ArticleId;

    const response = await createApp({ contextFactory: () => ctx }).request(
      `/v1/admin/articles/${id}/draft`,
      { method: "PUT", headers: auth, body: JSON.stringify({ ...draft, title: "改題" }) },
      { ADMIN_TOKEN: TOKEN } as unknown as Env,
    );
    expect(response.status).toBe(200);
    expect((await ctx.repos.revisions.findLatest(id))?.createdBy).toBe(IMPORTED);
  });

  it("answers 404 for a draft on an article that does not exist", async () => {
    const response = await createApp({ contextFactory: () => ctx }).request(
      "/v1/admin/articles/nope/draft",
      { method: "PUT", headers: auth, body: JSON.stringify(draft) },
      { ADMIN_TOKEN: TOKEN } as unknown as Env,
    );
    expect(response.status).toBe(404);
  });
});
