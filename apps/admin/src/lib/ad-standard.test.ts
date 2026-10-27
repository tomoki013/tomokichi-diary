import { describe, expect, it, vi } from "vitest";
import type {
  AdExperiment,
  ArticleDetailDto,
  ArticleMonetization,
  ArticleSummaryDto,
  MonetizationOverviewDto,
} from "@tomokichi/contracts";
import {
  adLayoutOf,
  applyLayout,
  auditArticles,
  blankConfig,
  bodyAdFits,
  markerKeys,
  prepareLayout,
  targetFor,
} from "./ad-standard";

const body = `導入文。\n\n## 回答\n\n${"体験の説明です。".repeat(75)}\n\n${"回答を伝える段落です。".repeat(12)}\n\n## 続きを読む\n\n${"残りの体験を説明します。".repeat(100)}`;
const end = {
  key: "article-end",
  kind: "adsense",
  position: "article_end",
  status: "ready",
  adUnit: "7152502134",
  offerId: null,
} as const;
const config = (patch: Partial<ArticleMonetization> = {}): ArticleMonetization => ({
  ...blankConfig(),
  placements: [end],
  ...patch,
});
const experiment: AdExperiment = {
  id: "placement-v1-ea3bf3bc-ffb6-84ed-8147-188ed74d7a50",
  articleId: "ea3bf3bc-ffb6-84ed-8147-188ed74d7a50",
  name: "test",
  markerKey: "body-test-v1",
  adUnitA: "7152502134",
  adUnitB: "7152502134",
  shareB: 50,
  status: "running",
  startedAt: "2026-10-17T00:00:00.000Z",
  stoppedAt: null,
  updatedAt: null,
};
const withMarker = (key: string) => {
  const at = body.indexOf("## 続きを読む");
  return `${body.slice(0, at)}{{monetization:${key}}}\n\n${body.slice(at)}`;
};

describe("applyLayout", () => {
  it("adds one body ad after a suggested paragraph and keeps the end ad", () => {
    const plan = applyLayout("standard", config(), body, null);
    if ("error" in plan) throw new Error(plan.error);
    expect(markerKeys(plan.body)).toEqual(["body-ad"]);
    expect(
      plan.body.replace(/\{\{monetization:body-ad\}\}\n\n/, "").replace(/\n{3,}/g, "\n\n"),
    ).toBe(body);
    expect(plan.config.placements.map((p) => `${p.position}/${p.status}`)).toEqual([
      "article_end/ready",
      "marker/ready",
    ]);
    expect(adLayoutOf(plan.config)).toBe("standard");
    expect(plan.changes).toEqual([expect.stringMatching(/^本文の約\d+%に広告を追加$/)]);
  });

  it("ends a running test by making its B slot the body ad, without touching the body", () => {
    const current = config({
      experimentId: experiment.id,
      placements: [end, { ...end, key: "body-test-v1", position: "marker", status: "paused" }],
    });
    const plan = applyLayout("standard", current, withMarker("body-test-v1"), experiment);
    if ("error" in plan) throw new Error(plan.error);
    expect(plan.body).toBe(withMarker("body-test-v1"));
    expect(plan.stopExperiment).toBe(experiment.id);
    expect(plan.config.experimentId).toBeNull();
    expect(plan.config.placements.find((p) => p.key === "body-test-v1")?.status).toBe("ready");
  });

  it("restarts a paused end ad and keeps affiliate slots and their mode", () => {
    const affiliate = {
      key: "slot-a",
      kind: "affiliate",
      position: "marker",
      status: "ready",
      adUnit: "7152502134",
      offerId: "offer",
    } as const;
    const current = config({
      mode: "hybrid",
      placements: [
        { ...end, status: "paused" },
        { ...end, key: "slot-b", position: "marker" },
        affiliate,
      ],
    });
    const plan = applyLayout("standard", current, withMarker("slot-b"), null);
    if ("error" in plan) throw new Error(plan.error);
    expect(plan.config.mode).toBe("hybrid");
    expect(plan.config.placements).toContainEqual(affiliate);
    expect(plan.config.placements[0]?.status).toBe("ready");
    expect(plan.changes).toEqual(["記事末尾の広告を表示"]);
  });

  it("reports nothing to change for an article already on the standard", () => {
    const current = config({ placements: [end, { ...end, key: "slot-b", position: "marker" }] });
    const plan = applyLayout("standard", current, withMarker("slot-b"), null);
    expect("error" in plan ? plan.error : plan.changes).toEqual([]);
  });

  it("moves a body ad that breaks the placement rule instead of failing on save", () => {
    const early = `{{monetization:slot-b}}\n\n${body}`;
    expect(bodyAdFits(early, "slot-b")).toBe(false);
    const current = config({ placements: [end, { ...end, key: "slot-b", position: "marker" }] });
    const plan = applyLayout("standard", current, early, null);
    if ("error" in plan) throw new Error(plan.error);
    expect(markerKeys(plan.body)).toEqual(["body-ad"]);
  });

  it("asks the author when no paragraph qualifies", () => {
    expect(applyLayout("standard", config(), "短い本文です。", null)).toHaveProperty("error");
  });

  it("removes body markers for end-only and turns everything off for none", () => {
    const current = config({ placements: [end, { ...end, key: "slot-b", position: "marker" }] });
    const endOnly = applyLayout("end-only", current, withMarker("slot-b"), null);
    if ("error" in endOnly) throw new Error(endOnly.error);
    expect(markerKeys(endOnly.body)).toEqual([]);
    expect(adLayoutOf(endOnly.config)).toBe("end-only");
    const none = applyLayout("none", current, body, null);
    if ("error" in none) throw new Error(none.error);
    expect(none.config).toMatchObject({ mode: "none", adsEnabled: false, placements: [] });
  });
});

const summary = (patch: Partial<ArticleSummaryDto>): ArticleSummaryDto =>
  ({
    id: "a",
    kind: "article",
    status: "published",
    isLive: true,
    hasUnpublishedChanges: false,
    noindex: false,
    title: "記事",
    ...patch,
  }) as ArticleSummaryDto;
const overview = (patch: Partial<MonetizationOverviewDto> = {}): MonetizationOverviewDto =>
  ({ articles: [], experiments: [], offers: [], publishedAdArticles: 0, ...patch }) as never;

describe("auditArticles", () => {
  it("takes switched-off articles to the end ad only, everything else to the standard", () => {
    expect(targetFor("off")).toBe("end-only");
    expect(targetFor("testing")).toBe("standard");
    expect(targetFor("missing-body")).toBe("standard");
  });

  it("classifies every live article by what readers get", () => {
    const result = auditArticles(
      [
        summary({ id: "none-config" }),
        summary({ id: "standard" }),
        summary({ id: "testing" }),
        summary({ id: "off" }),
        summary({ id: "end-only" }),
        summary({ id: "dirty", hasUnpublishedChanges: true }),
        summary({ id: "draft", status: "draft", isLive: false }),
        summary({ id: "page", kind: "page" }),
      ],
      overview({
        articles: [
          {
            articleId: "standard",
            config: config({ placements: [end, { ...end, key: "b", position: "marker" }] }),
          },
          { articleId: "off", config: config({ mode: "none", adsEnabled: false }) },
          { articleId: "end-only", config: config() },
        ],
        experiments: [{ ...experiment, articleId: "testing" }],
      }),
    );
    expect(Object.fromEntries(result.map((r) => [r.article.id, r.kind]))).toEqual({
      "none-config": "missing-body",
      standard: "standard",
      testing: "testing",
      off: "off",
      "end-only": "end-only",
      dirty: "unpublished",
      draft: "not-live",
    });
  });
});

describe("prepareLayout", () => {
  const article = {
    id: experiment.articleId,
    kind: "article",
    title: "旅行記",
    status: "published",
    isLive: true,
    hasUnpublishedChanges: false,
    publishedRevisionId: "r1",
    currentRevision: {
      id: "r1",
      title: "旅行記",
      summary: "説明",
      bodyMarkdown: body,
      seoTitleOverride: null,
      seoDescriptionOverride: null,
    },
  } as ArticleDetailDto;

  it("saves the body before the configuration and ends the test last", async () => {
    const calls: string[] = [];
    const client = {
      getArticle: vi.fn(async () => article),
      articleMonetization: vi.fn(async () => ({
        draft: config({ experimentId: experiment.id }),
        published: null,
        needsPublication: false,
      })),
      saveDraft: vi.fn(async () => (calls.push("body"), {}) as never),
      saveArticleMonetization: vi.fn(async (_id, c) => (calls.push("config"), c)),
      controlAdExperiment: vi.fn(async () => (calls.push("stop"), experiment)),
    };
    const result = await prepareLayout(
      summary({ id: article.id }),
      overview({ experiments: [experiment] }),
      "standard",
      client,
    );
    expect(calls).toEqual(["body", "config", "stop"]);
    expect(result.changes).toContain("A/Bテストを終了");
  });

  it("gives a short article the end ad only instead of failing", async () => {
    const short = {
      ...article,
      currentRevision: { ...article.currentRevision!, bodyMarkdown: "短い本文です。" },
    } as ArticleDetailDto;
    const client = {
      getArticle: vi.fn(async () => short),
      articleMonetization: vi.fn(async () => ({
        draft: blankConfig(),
        published: null,
        needsPublication: false,
      })),
      saveDraft: vi.fn(),
      saveArticleMonetization: vi.fn(async (_id, c) => c),
      controlAdExperiment: vi.fn(),
    };
    const result = await prepareLayout(summary({}), overview(), "standard", client);
    expect(result.changes).toEqual(["本文に置ける段落がないため末尾のみ"]);
    expect(client.saveDraft).not.toHaveBeenCalled();
    expect(adLayoutOf(client.saveArticleMonetization.mock.calls[0]![1])).toBe("end-only");
  });

  it("refuses an article that changed since the list was read", async () => {
    const client = {
      getArticle: vi.fn(async () => ({ ...article, hasUnpublishedChanges: true })),
      articleMonetization: vi.fn(),
      saveDraft: vi.fn(),
      saveArticleMonetization: vi.fn(),
      controlAdExperiment: vi.fn(),
    };
    await expect(prepareLayout(summary({}), overview(), "standard", client)).rejects.toThrow();
    expect(client.saveDraft).not.toHaveBeenCalled();
  });
});
