import {
  adExperimentId,
  adExperimentRound,
  type AdExperiment,
  type ArticleDetailDto,
  type ArticleSummaryDto,
  type MonetizationOverviewDto,
} from "@tomokichi/contracts";
import { api } from "./api";
import { applyLayout, bodyAdFits } from "./ad-standard";
import { draftFrom } from "./draft";

/**
 * A placement test, as the author describes it. The site renders one kind of
 * comparison — A shows the end ad only, B adds the body ad — so a condition
 * is who gets B, which units each side uses, and where B's body ad sits
 * (the article's own body ad, placed by the standard rule if missing).
 */
export interface AdTestCondition {
  name: string;
  shareB: number;
  adUnitA: string;
  adUnitB: string;
}

export const defaultCondition = (unit = "7152502134"): AdTestCondition => ({
  name: "本文中の広告あり/なし",
  shareB: 50,
  adUnitA: unit,
  adUnitB: unit,
});

/** The next unused ID for this article: a finished test is never restarted. */
export function nextExperimentId(
  articleId: string,
  experiments: readonly Pick<AdExperiment, "id" | "articleId">[],
): string {
  const rounds = experiments
    .filter((e) => e.articleId === articleId)
    .map((e) => adExperimentRound(e.id) ?? 1);
  return adExperimentId(articleId, rounds.length ? Math.max(...rounds) + 1 : 1);
}

/** Days since a test started, counting the start day as day 1. */
export function testDay(experiment: Pick<AdExperiment, "startedAt">, now = Date.now()): number {
  return experiment.startedAt
    ? Math.floor((now - Date.parse(experiment.startedAt)) / 86_400_000) + 1
    : 0;
}

/** The guide for reading a result; earlier than this the numbers are noise. */
export const TEST_MIN_DAYS = 14;

/** Live, unchanged and not already being tested: the only articles a test can start on. */
export function canStartTest(article: ArticleSummaryDto, overview: MonetizationOverviewDto) {
  const config = overview.articles.find((a) => a.articleId === article.id)?.config;
  return (
    article.kind === "article" &&
    article.isLive &&
    !article.hasUnpublishedChanges &&
    !article.noindex &&
    (!config || (config.adsEnabled && ["ads", "hybrid"].includes(config.mode))) &&
    !overview.experiments.some(
      (e) => e.articleId === article.id && (e.status === "running" || e.status === "draft"),
    )
  );
}

type Client = Pick<
  typeof api,
  | "getArticle"
  | "articleMonetization"
  | "saveDraft"
  | "saveArticleMonetization"
  | "saveAdExperiment"
  | "controlAdExperiment"
>;

/**
 * Starts a test on one article and leaves it ready to publish. B's body ad is
 * the article's own (added by the standard rule when missing), so the test
 * compares exactly what the standard layout adds.
 */
export async function prepareAdTest(
  summary: ArticleSummaryDto,
  overview: MonetizationOverviewDto,
  condition: AdTestCondition,
  client: Client = api,
): Promise<ArticleDetailDto> {
  const article = await client.getArticle(summary.id);
  if (!article.isLive || article.hasUnpublishedChanges || !article.currentRevision)
    throw new Error("公開中の最新版ではありません。記事編集で確認してください");
  const { draft } = await client.articleMonetization(article.id);
  const plan = applyLayout("standard", draft, article.currentRevision.bodyMarkdown, null);
  if ("error" in plan) throw new Error(plan.error);
  const body = plan.config.placements.find(
    (p) => p.kind === "adsense" && p.position === "marker" && p.status === "ready",
  );
  if (!body || !bodyAdFits(plan.body, body.key))
    throw new Error("本文中の広告の位置を記事編集で確認してください");
  if (plan.body !== article.currentRevision.bodyMarkdown)
    await client.saveDraft(article.id, {
      ...draftFrom(article),
      bodyMarkdown: plan.body,
      changeSummary: "配置テスト用に本文中の広告を追加（本文内容は維持）",
    });
  const experiment: AdExperiment = {
    id: nextExperimentId(article.id, overview.experiments),
    articleId: article.id,
    name: `${condition.name} · ${article.title}`.slice(0, 150),
    markerKey: body.key,
    adUnitA: condition.adUnitA,
    adUnitB: condition.adUnitB,
    shareB: condition.shareB,
    status: "draft",
    startedAt: null,
    stoppedAt: null,
    updatedAt: null,
  };
  await client.saveAdExperiment(experiment);
  await client.saveArticleMonetization(article.id, { ...plan.config, experimentId: experiment.id });
  await client.controlAdExperiment(experiment.id, "start");
  return client.getArticle(article.id);
}
