import { beforeEach, describe, expect, it } from "vitest";
import { createTestContext } from "@tomokichi/infra-d1/testing-context";
import type { AppContext } from "@tomokichi/application";
import { createApp } from "../app.js";
import type { Env } from "../env.js";

/*
 * Why this exists: `/v1/likes` is public and unauthenticated. The two things
 * that keep it from being abused — the visitor-id shape and the toggle
 * semantics (a second tap removes, never doubles) — had no tests.
 */

const TOKEN = "test-admin-token";
const env = { ADMIN_TOKEN: TOKEN } as unknown as Env;
const auth = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
const json = { "content-type": "application/json" };

let ctx: AppContext;
let app: ReturnType<typeof createApp>;

async function createArticle(): Promise<string> {
  const response = await app.request(
    "/v1/admin/articles",
    {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        slug: "wat-arun",
        locale: "ja",
        path: "/posts/wat-arun",
        draft: {
          title: "ワット・アルン",
          summary: "夕景",
          bodyMarkdown: "本文".repeat(200),
          seoTitleOverride: null,
          seoDescriptionOverride: null,
          changeSummary: null,
        },
      }),
    },
    env,
  );
  return ((await response.json()) as { id: string }).id;
}

/** Likes are only accepted on published articles, so the fixture is published
 * straight through the repository — the publish rules have their own tests. */
async function publish(id: string): Promise<void> {
  const article = await ctx.repos.articles.findById(id as never);
  if (!article) throw new Error("fixture article missing");
  await ctx.repos.articles.save({
    ...article,
    status: "published",
    publishedRevisionId: article.currentRevisionId,
    publishedAt: ctx.clock.now(),
  });
}

const visitor = "visitor-0123456789abcdefghij";

beforeEach(async () => {
  ctx = await createTestContext();
  app = createApp({ contextFactory: () => ctx });
});

describe("/v1/likes/:articleId", () => {
  it("rejects a visitor id that is missing, too short or not plain ASCII", async () => {
    const id = await createArticle();
    for (const visitorId of [
      "",
      "short",
      "x".repeat(81),
      "has space here 1234567890",
      "日本語の識別子12345678901",
    ]) {
      const response = await app.request(
        `/v1/likes/${id}`,
        { method: "POST", headers: json, body: JSON.stringify({ visitorId }) },
        env,
      );
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("API_VALIDATION_FAILED");
    }
    const notJson = await app.request(`/v1/likes/${id}`, { method: "POST", body: "nope" }, env);
    expect(notJson.status).toBe(400);
  });

  it("returns 404 for an unknown article and for one that is not published", async () => {
    const draft = await createArticle();
    for (const target of ["no-such-article", draft]) {
      const response = await app.request(
        `/v1/likes/${target}`,
        { method: "POST", headers: json, body: JSON.stringify({ visitorId: visitor }) },
        env,
      );
      expect(response.status).toBe(404);
      expect((await response.json()).error.code).toBe("ARTICLE_NOT_FOUND");
    }
  });

  it("toggles: the same visitor's second tap removes the like, a second visitor adds one", async () => {
    const id = await createArticle();
    await publish(id);
    const post = (visitorId: string) =>
      app.request(
        `/v1/likes/${id}`,
        { method: "POST", headers: json, body: JSON.stringify({ visitorId }) },
        env,
      );
    expect(await (await post(visitor)).json()).toMatchObject({ count: 1, liked: true });
    expect(await (await post(visitor)).json()).toMatchObject({ count: 0, liked: false });
    expect(await (await post(visitor)).json()).toMatchObject({ count: 1, liked: true });
    expect(await (await post(`${visitor}-2`)).json()).toMatchObject({ count: 2, liked: true });

    const mine = await app.request(`/v1/likes/${id}?visitorId=${visitor}`, {}, env);
    expect(await mine.json()).toMatchObject({ count: 2, liked: true });
    const anonymous = await app.request(`/v1/likes/${id}`, {}, env);
    expect(await anonymous.json()).toMatchObject({ count: 2, liked: false });
  });
});
