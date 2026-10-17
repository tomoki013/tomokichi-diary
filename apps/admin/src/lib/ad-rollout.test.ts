import { expect, it, vi } from "vitest";
import type {
  ArticleDetailDto,
  ArticleMonetization,
  MonetizationOverviewDto,
} from "@tomokichi/contracts";
import {
  prepareAdRollout,
  previewAdRollout,
  suggestAdParagraph,
  type AdRolloutPlan,
} from "./ad-rollout";
const body = `導入文。\n\n## 回答\n\n${"体験の説明です。".repeat(75)}\n\n${"回答を伝える段落です。".repeat(12)}\n\n## 続きを読む\n\n${"残りの体験を説明します。".repeat(100)}`;
const article = {
  id: "ea3bf3bc-ffb6-84ed-8147-188ed74d7a50",
  kind: "article",
  title: "旅行記",
  status: "published",
  isLive: true,
  hasUnpublishedChanges: false,
  noindex: false,
  publishedRevisionId: "original",
  currentRevision: {
    id: "original",
    title: "旅行記",
    summary: "説明",
    bodyMarkdown: body,
    seoTitleOverride: "SEO維持",
    seoDescriptionOverride: null,
  },
} as ArticleDetailDto;
const config: ArticleMonetization = {
  mode: "ads",
  adsEnabled: true,
  maxAds: 1,
  experimentId: null,
  placements: [
    {
      key: "article-end",
      kind: "adsense",
      position: "article_end",
      status: "ready",
      adUnit: "7152502134",
      offerId: null,
    },
  ],
  updatedAt: null,
};
function client() {
  let current = structuredClone(article);
  return {
    getArticle: vi.fn(async () => current),
    articleMonetization: vi.fn(async () => ({
      draft: config,
      published: null,
      needsPublication: false,
    })),
    saveDraft: vi.fn(async (_id, draft) => {
      current = {
        ...current,
        currentRevision: { ...current.currentRevision!, ...draft, id: "saved" },
      };
      return { revision: { id: "saved", revisionNumber: 2 } };
    }),
    saveArticleMonetization: vi.fn(async (_id, value) => value),
    saveAdExperiment: vi.fn(async (value) => value),
    controlAdExperiment: vi.fn(async () => ({}) as never),
  };
}
it("selects prose after sufficient content, never inside code, lists, images or related cards", () => {
  const position = suggestAdParagraph(body);
  expect(position).not.toBeNull();
  expect(position!.fraction).toBeGreaterThanOrEqual(0.3);
  expect(suggestAdParagraph("短い記事\n\n## 回答\n\n本文。")).toBeNull();
  expect(suggestAdParagraph(`## 回答\n\n\`\`\`\n${body}\n\`\`\``)).toBeNull();
  expect(suggestAdParagraph(`## 回答\n\n${"![画像](x.jpg)\n\n".repeat(300)}`)).toBeNull();
});
it("preserves all prose and SEO while preparing an opted-in one-slot experiment", async () => {
  const c = client();
  const plan: AdRolloutPlan = { article, ...suggestAdParagraph(body)! };
  const result = await prepareAdRollout(plan, c);
  const draft = c.saveDraft.mock.calls[0]![1];
  expect(draft.bodyMarkdown.replace("\n\n{{monetization:body-test-v1}}\n\n", "")).toBe(body);
  expect(draft.seoTitleOverride).toBe("SEO維持");
  expect(c.saveAdExperiment.mock.calls[0]![0]).toMatchObject({ articleId: article.id, shareB: 50 });
  expect(c.controlAdExperiment).toHaveBeenCalledWith(`placement-v1-${article.id}`, "start");
  const saved = c.saveArticleMonetization.mock.calls[1]![1];
  expect(
    saved.placements.filter(
      (p: ArticleMonetization["placements"][number]) =>
        p.kind === "adsense" && p.status === "ready",
    ),
  ).toHaveLength(1);
  expect(result.revisionId).toBe("saved");
});
it("rejects a changed revision or individual ad policy before any write", async () => {
  const plan = { article, ...suggestAdParagraph(body)! };
  const c = client();
  c.getArticle.mockResolvedValue({ ...article, hasUnpublishedChanges: true });
  await expect(prepareAdRollout(plan, c)).rejects.toThrow("変更");
  expect(c.saveDraft).not.toHaveBeenCalled();
  const c2 = client();
  c2.articleMonetization.mockResolvedValue({
    draft: { ...config, adsEnabled: false },
    published: null,
    needsPublication: false,
  });
  await expect(prepareAdRollout(plan, c2)).rejects.toThrow("個別設定");
  expect(c2.saveDraft).not.toHaveBeenCalled();
});
it("excludes drafts, existing configurations and experiments from a broad rollout", async () => {
  const c = client();
  const overview = { articles: [], experiments: [] } as unknown as MonetizationOverviewDto;
  const result = await previewAdRollout(
    [
      article,
      { ...article, id: "draft", hasUnpublishedChanges: true },
      { ...article, id: "existing" },
    ],
    { ...overview, experiments: [{ articleId: "existing" }] as never },
    () => {},
    c,
  );
  expect(result.plans).toHaveLength(1);
  expect(c.getArticle).toHaveBeenCalledTimes(1);
});
it("propagates a preparation failure without starting the experiment", async () => {
  const c = client();
  c.saveAdExperiment.mockRejectedValue(new Error("一時的な通信エラー"));
  await expect(prepareAdRollout({ article, ...suggestAdParagraph(body)! }, c)).rejects.toThrow();
  expect(c.controlAdExperiment).not.toHaveBeenCalled();
});
