import { describe, expect, it, vi } from "vitest";
import type {
  AdExperiment,
  ArticleDetailDto,
  ArticleMonetization,
  ArticleSummaryDto,
  MonetizationOverviewDto,
} from "@tomokichi/contracts";
import { blankConfig, markerKeys } from "./ad-standard";
import {
  canStartTest,
  defaultCondition,
  nextExperimentId,
  prepareAdTest,
  testDay,
} from "./ad-test";

const id = "ea3bf3bc-ffb6-84ed-8147-188ed74d7a50";
const body = `導入文。\n\n## 回答\n\n${"体験の説明です。".repeat(75)}\n\n${"回答を伝える段落です。".repeat(12)}\n\n## 続きを読む\n\n${"残りの体験を説明します。".repeat(100)}`;
const article = {
  id,
  kind: "article",
  title: "旅行記",
  status: "published",
  isLive: true,
  hasUnpublishedChanges: false,
  noindex: false,
  publishedRevisionId: "r1",
  currentRevision: {
    id: "r1",
    title: "旅行記",
    summary: "説明",
    bodyMarkdown: body,
    seoTitleOverride: "SEO維持",
    seoDescriptionOverride: null,
  },
} as ArticleDetailDto;
const overview = (experiments: Partial<AdExperiment>[] = []) =>
  ({ articles: [], experiments, offers: [] }) as unknown as MonetizationOverviewDto;

function client() {
  const calls: string[] = [];
  return {
    calls,
    getArticle: vi.fn(async () => article),
    articleMonetization: vi.fn(async () => ({
      draft: blankConfig(),
      published: null,
      needsPublication: false,
    })),
    saveDraft: vi.fn(async () => (calls.push("body"), {}) as never),
    saveAdExperiment: vi.fn(async (e: AdExperiment) => (calls.push("experiment"), e)),
    saveArticleMonetization: vi.fn(
      async (_id: string, c: ArticleMonetization) => (calls.push("config"), c),
    ),
    controlAdExperiment: vi.fn(async () => (calls.push("start"), {}) as never),
  };
}

describe("nextExperimentId", () => {
  it("never reuses a finished test's ID", () => {
    expect(nextExperimentId(id, [])).toBe(`placement-v1-${id}`);
    expect(nextExperimentId(id, [{ id: `placement-v1-${id}`, articleId: id }])).toBe(
      `placement-v1-${id}-r2`,
    );
    expect(
      nextExperimentId(id, [
        { id: `placement-v1-${id}`, articleId: id },
        { id: `placement-v1-${id}-r3`, articleId: id },
      ]),
    ).toBe(`placement-v1-${id}-r4`);
  });
});

describe("canStartTest", () => {
  const summary = article as unknown as ArticleSummaryDto;
  it("allows a new round once the previous test ended, never two at once", () => {
    expect(canStartTest(summary, overview([{ articleId: id, status: "stopped" }]))).toBe(true);
    expect(canStartTest(summary, overview([{ articleId: id, status: "running" }]))).toBe(false);
    expect(canStartTest({ ...summary, hasUnpublishedChanges: true }, overview())).toBe(false);
  });
});

describe("prepareAdTest", () => {
  it("adds the standard body ad, keeps the prose and SEO, and starts with the condition", async () => {
    const c = client();
    await prepareAdTest(
      article as unknown as ArticleSummaryDto,
      overview([{ id: `placement-v1-${id}`, articleId: id, status: "stopped" }]),
      { ...defaultCondition(), shareB: 30 },
      c,
    );
    expect(c.calls).toEqual(["body", "experiment", "config", "start"]);
    const draft = (
      c.saveDraft.mock.calls[0] as unknown as [
        string,
        { bodyMarkdown: string; seoTitleOverride: string },
      ]
    )[1];
    expect(markerKeys(draft.bodyMarkdown)).toEqual(["body-ad"]);
    expect(draft.seoTitleOverride).toBe("SEO維持");
    expect(c.saveAdExperiment.mock.calls[0]![0]).toMatchObject({
      id: `placement-v1-${id}-r2`,
      markerKey: "body-ad",
      shareB: 30,
      status: "draft",
    });
  });

  it("does not start when a save fails", async () => {
    const c = client();
    c.saveAdExperiment.mockRejectedValue(new Error("通信エラー"));
    await expect(
      prepareAdTest(article as unknown as ArticleSummaryDto, overview(), defaultCondition(), c),
    ).rejects.toThrow();
    expect(c.controlAdExperiment).not.toHaveBeenCalled();
  });

  it("refuses an article with unpublished changes before any write", async () => {
    const c = client();
    c.getArticle.mockResolvedValue({ ...article, hasUnpublishedChanges: true });
    await expect(
      prepareAdTest(article as unknown as ArticleSummaryDto, overview(), defaultCondition(), c),
    ).rejects.toThrow();
    expect(c.saveDraft).not.toHaveBeenCalled();
  });
});

it("counts the start day as day 1", () => {
  expect(
    testDay({ startedAt: "2026-10-17T00:00:00.000Z" }, Date.parse("2026-10-30T12:00:00Z")),
  ).toBe(14);
  expect(testDay({ startedAt: null })).toBe(0);
});
