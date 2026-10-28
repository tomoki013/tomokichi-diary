import { beforeEach, expect, it } from "vitest";
import { createTestContext } from "@tomokichi/infra-d1/testing-context";
import {
  createArticle,
  loadContentSnapshot,
  publishArticle,
  type AppContext,
} from "@tomokichi/application";
import { buildExportFiles } from "@tomokichi/data";
import {
  defaultArticleMonetization,
  DEFAULT_MONETIZATION_SETTINGS,
  type ArticleId,
  type AuthorId,
  type MediaId,
} from "@tomokichi/domain";
import { createApp } from "../app.js";
import type { Env } from "../env.js";
const authorId = "author-tomokichi" as AuthorId;
const body = `導入文。\n\n## おすすめの回答\n\n${"体験した内容を説明する文章。".repeat(80)}\n\n{{monetization:answer-end}}\n\n続きの文章。`;
let ctx: AppContext;
let app: ReturnType<typeof createApp>;
let id: ArticleId;
const env = { ADMIN_TOKEN: "test" } as Env;
const headers = { authorization: "Bearer test", "content-type": "application/json" };
async function request(
  path: string,
  value?: unknown,
  method = value === undefined ? "GET" : "PUT",
) {
  return app.request(
    `/v1/admin/monetization${path}`,
    { method, headers, ...(value === undefined ? {} : { body: JSON.stringify(value) }) },
    env,
  );
}
beforeEach(async () => {
  ctx = {
    ...(await createTestContext()),
    ids: { next: <T extends string>() => crypto.randomUUID() as T },
  };
  app = createApp({ contextFactory: () => ctx, publishSite: async () => ({ state: "queued" }) });
  const article = await createArticle(ctx, {
    slug: "monetization",
    locale: "ja",
    authorId,
    path: "/posts/monetization",
    draft: {
      title: "体験したおすすめメニューの紹介",
      summary: "実際に訪ねた体験をもとにまとめた記事です。",
      bodyMarkdown: body,
    },
  });
  if (!article.ok) throw new Error("fixture");
  id = article.value.article.id;
  const mediaId = "cover" as MediaId;
  await ctx.repos.media.save({
    id: mediaId,
    storageKey: "cover.jpg",
    mimeType: "image/jpeg",
    width: 300,
    height: 200,
    size: 100,
    sha256: "a".repeat(64),
    createdAt: ctx.clock.now(),
  });
  await ctx.repos.media.replaceForArticle(id, [
    { articleId: id, mediaId, role: "cover", sortOrder: 0, alt: "旅の写真", caption: null },
  ]);
});
it("protects all operations and exposes no public monetization route", async () => {
  for (const path of ["/", `/articles/${id}`, "/settings", "/offers/x", "/experiments/x/start"]) {
    const response = await app.request(
      `/v1/admin/monetization${path}`,
      { method: path.includes("start") ? "POST" : "GET" },
      env,
    );
    expect(response.status).toBe(401);
  }
  expect((await app.request("/v1/monetization", {}, env)).status).toBe(404);
});
it("keeps offer content private, archives referenced offers, and retains assignments", async () => {
  const offer = {
    id: "offer-one",
    name: "PRIVATE_OFFER",
    provider: "未選定",
    category: "宿泊",
    heading: "予約",
    description: "PRIVATE_DESCRIPTION",
    imageUrl: null,
    url: "https://example.com/private-affiliate",
    format: "booking_card",
    notes: "PRIVATE_NOTE",
    status: "draft",
    checkedAt: null,
    updatedAt: null,
  };
  expect((await request("/offers/offer-one", offer)).status).toBe(200);
  const config = {
    ...defaultArticleMonetization(),
    placements: [
      ...defaultArticleMonetization().placements,
      {
        key: "answer-end",
        kind: "affiliate",
        position: "marker",
        status: "ready",
        adUnit: "7152502134",
        offerId: "offer-one",
      },
    ],
  };
  expect((await request(`/articles/${id}`, config)).status).toBe(200);
  expect((await publishArticle(ctx, id)).ok).toBe(true);
  const files = JSON.stringify(buildExportFiles(await loadContentSnapshot(ctx)));
  for (const secret of [
    "PRIVATE_OFFER",
    "PRIVATE_DESCRIPTION",
    "PRIVATE_NOTE",
    "private-affiliate",
    "offer-one",
  ])
    expect(files).not.toContain(secret);
  expect((await request("/offers/offer-one", undefined, "DELETE")).status).toBe(200);
  expect((await (await request(`/articles/${id}`)).json()).draft.placements[1].offerId).toBe(
    "offer-one",
  );
  expect((await request("/offers/offer-one", offer)).status).toBe(400);
});
it("rejects unsafe URLs, unsupported statuses and cross-article or missing references", async () => {
  const offer = {
    id: "offer-one",
    name: "案件",
    provider: "",
    category: "",
    heading: "",
    description: "",
    imageUrl: null,
    url: "javascript:alert(1)",
    format: "booking_card",
    notes: "",
    status: "draft",
    checkedAt: null,
  };
  expect((await request("/offers/offer-one", offer)).status).toBe(400);
  expect(
    (await request("/offers/offer-one", { ...offer, url: null, status: "active" })).status,
  ).toBe(400);
  expect(
    (await request("/settings", { ...DEFAULT_MONETIZATION_SETTINGS, affiliateEnabled: true }))
      .status,
  ).toBe(200);
  expect(
    (
      await request(`/articles/${id}`, {
        ...defaultArticleMonetization(),
        experimentId: "other-article",
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await request(`/articles/${id}`, {
        ...defaultArticleMonetization(),
        placements: [
          {
            key: "answer-end",
            kind: "affiliate",
            position: "marker",
            status: "ready",
            adUnit: "7152502134",
            offerId: "missing",
          },
        ],
      })
    ).status,
  ).toBe(400);
  const c = defaultArticleMonetization();
  expect(
    (await request(`/articles/${id}`, { ...c, placements: [...c.placements, ...c.placements] }))
      .status,
  ).toBe(400);
});
