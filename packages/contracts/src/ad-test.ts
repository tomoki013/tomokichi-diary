import { adParagraphCandidates } from "./article-markdown.js";
import type { ArticleSummaryDto } from "./dto.js";
import {
  adExperimentId,
  adExperimentRound,
  type AdExperiment,
  type MonetizationOverviewDto,
} from "./monetization.js";

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
