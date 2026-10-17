import { beforeEach, expect, it } from "vitest";
import { createTestContext } from "@tomokichi/infra-d1/testing-context";
import {
  createArticle,
  loadContentSnapshot,
  publishArticle,
  updateArticleDraft,
  saveArticleMonetization,
  saveAdExperiment,
  saveMonetizationSettings,
  type AppContext,
} from "@tomokichi/application";
import { buildExportFiles } from "@tomokichi/data";
import {
  defaultArticleMonetization,
  DEFAULT_MONETIZATION_SETTINGS,
  type ArticleId,
  type AuthorId,
  type MediaId,
  type AdExperiment,
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
it("saves and reloads draft settings without changing the public snapshot; publishing applies them", async () => {
  expect((await publishArticle(ctx, id)).ok).toBe(true);
  const before = await loadContentSnapshot(ctx);
  const config = { ...defaultArticleMonetization(), mode: "none" };
  expect((await request(`/articles/${id}`, config)).status).toBe(200);
  const result = await (await request(`/articles/${id}`)).json();
  expect(result.draft.mode).toBe("none");
  expect(result.needsPublication).toBe(true);
  expect((await loadContentSnapshot(ctx)).monetization).toEqual(before.monetization);
  expect((await publishArticle(ctx, id)).ok).toBe(true);
  expect((await loadContentSnapshot(ctx)).monetization?.[0]?.enabled).toBe(false);
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
it("rejects unsafe URLs, unsupported statuses, flags and cross-article or missing references", async () => {
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
  ).toBe(400);
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
it("blocks publication if a saved marker disappears and never moves it to the end", async () => {
  await saveMonetizationSettings(ctx, {
    ...DEFAULT_MONETIZATION_SETTINGS,
    placementsEnabled: true,
  });
  expect(
    (
      await saveArticleMonetization(ctx, id, {
        ...defaultArticleMonetization(),
        placements: [
          {
            key: "answer-end",
            kind: "adsense",
            position: "marker",
            status: "ready",
            adUnit: "7152502134",
            offerId: null,
          },
        ],
      })
    ).ok,
  ).toBe(true);
  await updateArticleDraft(
    ctx,
    id,
    {
      title: "体験したおすすめメニューの紹介",
      summary: "実際に訪ねた体験をもとにまとめた記事です。",
      bodyMarkdown: body.replace("{{monetization:answer-end}}", ""),
    },
    authorId,
  );
  const result = await publishArticle(ctx, id);
  expect(result.ok).toBe(false);
});
it("starts only a prepared opted-in experiment and stops through publication to the original end placement", async () => {
  const original = await ctx.repos.articles.findById(id);
  if (!original) throw new Error();
  const target = "52b1cb6d-eb74-85a3-b6a1-392f83313051" as ArticleId;
  // Give this fixture the initial allowlisted identity without modifying any real article.
  await ctx.repos.articles.save({
    ...original,
    id: target,
    slug: "experiment" as typeof original.slug,
  });
  const revision = await ctx.repos.revisions.findById(original.currentRevisionId!);
  if (!revision) throw new Error();
  const rid = "experiment-revision" as typeof revision.id;
  await ctx.repos.revisions.save({ ...revision, id: rid, articleId: target });
  await ctx.repos.articles.save({
    ...original,
    id: target,
    slug: "experiment" as typeof original.slug,
    currentRevisionId: rid,
  });
  const experiment: AdExperiment = {
    id: "chagee-placement-v1",
    articleId: target,
    name: "配置比較",
    markerKey: "answer-end",
    adUnitA: "7152502134",
    adUnitB: "7152502134",
    shareB: 50,
    status: "draft",
    startedAt: null,
    stoppedAt: null,
    updatedAt: null,
  };
  expect((await saveAdExperiment(ctx, experiment)).ok).toBe(true);
  expect((await saveAdExperiment(ctx, experiment, "start")).ok).toBe(false);
  await saveMonetizationSettings(ctx, {
    ...DEFAULT_MONETIZATION_SETTINGS,
    placementsEnabled: true,
    experimentsEnabled: true,
  });
  await saveArticleMonetization(ctx, target, {
    ...defaultArticleMonetization(),
    experimentId: experiment.id,
  });
  expect((await saveAdExperiment(ctx, experiment, "start")).ok).toBe(true);
  expect((await saveAdExperiment(ctx, experiment)).ok).toBe(false);
  expect((await saveAdExperiment(ctx, experiment, "start")).ok).toBe(false);
  expect((await saveAdExperiment(ctx, experiment, "stop")).ok).toBe(true);
  const { projectArticleMonetization } = await import("@tomokichi/application");
  const stopped = await projectArticleMonetization(ctx, target);
  expect(stopped.experiment).toBeNull();
  expect(stopped.placement?.position).toBe("article_end");
});
it("preserves prose, embeds and knowledge when a metadata-only edit creates an unpublished revision", async () => {
  const article = await ctx.repos.articles.findById(id);
  const rid = article!.currentRevisionId!;
  await ctx.repos.embeds.replaceForRevision(rid, [
    {
      id: "embed-test",
      revisionId: rid,
      anchorKey: "map-one",
      type: "map",
      schemaVersion: 1,
      payload: { label: "original embed" },
    },
  ]);
  await ctx.repos.knowledge.saveArticleKnowledge({
    articleId: id,
    revisionId: rid,
    schemaVersion: 1,
    quickAnswer: null,
    decisionTable: null,
    experienceGroups: [],
    currentFactIds: [],
    cautionFactIds: [],
    routeIds: [],
    relatedArticles: [],
  });
  expect((await publishArticle(ctx, id)).ok).toBe(true);
  expect(
    (await saveArticleMonetization(ctx, id, { ...defaultArticleMonetization(), mode: "none" })).ok,
  ).toBe(true);
  const changed = await ctx.repos.articles.findById(id);
  expect(changed!.currentRevisionId).not.toBe(rid);
  expect(changed!.publishedRevisionId).toBe(rid);
  expect((await ctx.repos.revisions.findById(changed!.currentRevisionId!))?.bodyMarkdown).toBe(
    body,
  );
  expect((await ctx.repos.embeds.listByRevision(changed!.currentRevisionId!))[0]?.payload).toEqual({
    label: "original embed",
  });
  expect(
    (await ctx.repos.knowledge.listArticleKnowledge()).some(
      (k) => k.revisionId === changed!.currentRevisionId,
    ),
  ).toBe(true);
  expect((await publishArticle(ctx, id)).ok).toBe(true);
});
it("retains structured embeds when the editor saves body and monetization together", async () => {
  const article = await ctx.repos.articles.findById(id);
  const rid = article!.currentRevisionId!;
  await ctx.repos.embeds.replaceForRevision(rid, [
    {
      id: "original",
      revisionId: rid,
      anchorKey: "map-one",
      type: "map",
      schemaVersion: 1,
      payload: { label: "preserved" },
    },
  ]);
  expect((await publishArticle(ctx, id)).ok).toBe(true);
  const result = await updateArticleDraft(
    ctx,
    id,
    {
      title: "体験したおすすめメニューの紹介",
      summary: "実際に訪ねた体験をもとにまとめた記事です。",
      bodyMarkdown: body,
    },
    authorId,
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error();
  expect((await ctx.repos.embeds.listByRevision(result.value.revision.id))[0]?.anchorKey).toBe(
    "map-one",
  );
  expect((await ctx.repos.embeds.listByRevision(rid))[0]?.anchorKey).toBe("map-one");
});
it("supports article-bound trials beyond CHAGEE and rejects another article's experiment ID", async () => {
  const e: AdExperiment = {
    id: `placement-v1-${id}`,
    articleId: id,
    name: "末尾 / 本文",
    markerKey: "answer-end",
    adUnitA: "7152502134",
    adUnitB: "7152502134",
    shareB: 50,
    status: "draft",
    startedAt: null,
    stoppedAt: null,
    updatedAt: null,
  };
  expect((await request(`/experiments/${e.id}`, e)).status).toBe(200);
  await saveMonetizationSettings(ctx, {
    ...DEFAULT_MONETIZATION_SETTINGS,
    placementsEnabled: true,
    experimentsEnabled: true,
  });
  await saveArticleMonetization(ctx, id, { ...defaultArticleMonetization(), experimentId: e.id });
  expect((await request(`/experiments/${e.id}/start`, undefined, "POST")).status).toBe(200);
  expect((await publishArticle(ctx, id)).ok).toBe(true);
  expect(
    (await loadContentSnapshot(ctx)).monetization?.find((m) => m.articleId === id)?.experiment?.id,
  ).toBe(e.id);
  expect(
    (
      await request(`/experiments/${e.id}`, {
        ...e,
        articleId: "52b1cb6d-eb74-85a3-b6a1-392f83313051",
      })
    ).status,
  ).toBe(400);
  expect((await request(`/experiments/${e.id}/stop`, undefined, "POST")).status).toBe(200);
  expect((await publishArticle(ctx, id)).ok).toBe(true);
  const stopped = (await loadContentSnapshot(ctx)).monetization?.find((m) => m.articleId === id);
  expect(stopped?.experiment).toBeNull();
  expect(stopped?.placement?.position).toBe("article_end");
});
