import {
  adExperimentId,
  adParagraphCandidates,
  adExperimentRound,
  type AdExperiment,
  type ArticleDetailDto,
  type ArticleSummaryDto,
  type MonetizationOverviewDto,
} from "@tomokichi/contracts";
import type { AdClient } from "./ad-client";
import { applyLayout, bodyAdFits, insertMarker, markerKeys } from "./ad-standard";
import { draftFrom } from "./draft";

/**
 * A placement test, as the author describes it. Every reader keeps the
 * article-end ad; the test compares where the one body ad goes. A keeps the
 * article's own body ad (placed by the standard rule if missing), B moves it
 * to another paragraph: the one after `afterText` when given, otherwise one
 * picked well away from A's.
 */
export interface AdTestCondition {
  name: string;
  shareB: number;
  adUnitA: string;
  adUnitB: string;
  afterText?: string;
}

export const defaultCondition = (unit = "7152502134"): AdTestCondition => ({
  name: "本文中の広告の位置",
  shareB: 50,
  adUnitA: unit,
  adUnitB: unit,
});

/**
 * Where B's body ad goes. With `afterText`, the qualifying paragraph whose
 * closing text contains it; otherwise the qualifying paragraph at least 15% of the body
 * away from A's, as close as possible to the other side of the article.
 */
export function positionB(body: string, aKey: string, afterText?: string) {
  const candidates = adParagraphCandidates(body, 0.25, 0.85);
  if (afterText?.trim())
    return candidates.find((c) => c.excerpt.includes(afterText.trim())) ?? null;
  const a = body.indexOf(`{{monetization:${aKey}}}`) / body.length;
  const target = a < 0.45 ? 0.65 : 0.3;
  return (
    candidates
      .filter((c) => Math.abs(c.fraction - a) >= 0.15)
      .toSorted((x, y) => Math.abs(x.fraction - target) - Math.abs(y.fraction - target))[0] ?? null
  );
}

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

type Client = AdClient;

/**
 * Starts a position test on one article and leaves it ready to publish. A's
 * body ad is the article's own (added by the standard rule when missing); B's
 * marker is added at `positionB`. Both pass the publish check's rule.
 */
export async function prepareAdTest(
  summary: ArticleSummaryDto,
  overview: MonetizationOverviewDto,
  condition: AdTestCondition,
  client: Client,
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
  const spot = positionB(plan.body, body.key, condition.afterText);
  if (!spot)
    throw new Error(
      condition.afterText
        ? "指定した段落の後には公開ルール上置けません"
        : "Bの本文中の広告を置ける別の段落がありません",
    );
  const present = new Set(markerKeys(plan.body));
  const bKey = ["body-ad-b", "body-ad-b-2", "body-ad-b-3"].find((k) => !present.has(k))!;
  const nextBody = insertMarker(plan.body, spot.offset, bKey);
  if (!bodyAdFits(nextBody, bKey) || !bodyAdFits(nextBody, body.key))
    throw new Error("Bの本文中の広告の位置を記事編集で確認してください");
  if (nextBody !== article.currentRevision.bodyMarkdown)
    await client.saveDraft(article.id, {
      ...draftFrom(article),
      bodyMarkdown: nextBody,
      changeSummary: "広告の位置テスト用に本文中の広告の候補位置を追加（本文内容は維持）",
    });
  const experiment: AdExperiment = {
    id: nextExperimentId(article.id, overview.experiments),
    articleId: article.id,
    name: `${condition.name} · ${article.title}`.slice(0, 150),
    markerKey: bKey,
    markerKeyA: body.key,
    adUnitA: condition.adUnitA,
    adUnitB: condition.adUnitB,
    shareB: condition.shareB,
    status: "draft",
    startedAt: null,
    stoppedAt: null,
    updatedAt: null,
  };
  await client.saveAdExperiment(experiment);
  // B's marker is configured but paused: only one body ad is "ready" outside
  // the test, and the test itself shows each arm its own.
  await client.saveArticleMonetization(article.id, {
    ...plan.config,
    experimentId: experiment.id,
    placements: [
      ...plan.config.placements,
      {
        key: bKey,
        kind: "adsense",
        position: "marker",
        status: "paused",
        adUnit: condition.adUnitB,
        offerId: null,
      },
    ],
  });
  await client.controlAdExperiment(experiment.id, "start");
  return client.getArticle(article.id);
}
