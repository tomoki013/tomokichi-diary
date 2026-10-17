import { marked } from "marked";
import {
  adExperimentId,
  type AdExperiment,
  type ArticleDetailDto,
  type ArticleSummaryDto,
  type MonetizationOverviewDto,
} from "@tomokichi/contracts";
import { api } from "./api";
import { draftFrom } from "./draft";

export interface AdRolloutPlan {
  article: ArticleDetailDto;
  offset: number;
  excerpt: string;
  fraction: number;
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
const markerKey = "body-test-v1";
const unsafe = (raw: string) =>
  /!\[|\{\{(?:embed|monetization):|<\/?(?:img|figure|aside|iframe|video|script)|^\s*\[.+\]\(/im.test(
    raw,
  );
/** Only top-level prose paragraphs, after the introduction and away from images/cards/embeds. */
export function suggestAdParagraph(body: string): Omit<AdRolloutPlan, "article"> | null {
  const tokens = marked.lexer(body);
  let cursor = 0;
  const candidates: Omit<AdRolloutPlan, "article">[] = [];
  const content = tokens.filter((t) => t.type !== "space");
  for (let i = 0; i < content.length; i++) {
    const token = content[i]!;
    const start = body.indexOf(token.raw, cursor);
    if (start < 0) continue;
    cursor = start + token.raw.length;
    const before = body.slice(0, cursor);
    const next = content[i + 1];
    if (
      token.type !== "paragraph" ||
      unsafe(token.raw) ||
      !next ||
      unsafe(next.raw) ||
      next.type === "html" ||
      next.type === "code" ||
      next.type === "table"
    )
      continue;
    if (before.replace(/\s/g, "").length < 600 || !/^## /m.test(before)) continue;
    const fraction = cursor / body.length;
    if (fraction < 0.3 || fraction > 0.65 || token.raw.trim().length < 30) continue;
    candidates.push({ offset: cursor, excerpt: token.raw.trim().slice(-140), fraction });
  }
  return (
    candidates.toSorted((a, b) => Math.abs(a.fraction - 0.4) - Math.abs(b.fraction - 0.4))[0] ??
    null
  );
}
export function rolloutCandidate(
  article: ArticleSummaryDto,
  overview: MonetizationOverviewDto,
): boolean {
  return (
    article.kind === "article" &&
    article.status === "published" &&
    article.isLive &&
    !article.noindex &&
    !article.hasUnpublishedChanges &&
    !overview.articles.some((a) => a.articleId === article.id) &&
    !overview.experiments.some((e) => e.articleId === article.id)
  );
}
export async function previewAdRollout(
  articles: readonly ArticleSummaryDto[],
  overview: MonetizationOverviewDto,
  progress: (done: number) => void,
  client: Client = api,
) {
  const plans: AdRolloutPlan[] = [];
  const skipped: { title: string; reason: string }[] = [];
  const candidates = articles.filter((a) => rolloutCandidate(a, overview));
  for (const [i, summary] of candidates.entries()) {
    try {
      const article = await client.getArticle(summary.id);
      if (
        !rolloutCandidate(article, overview) ||
        !article.currentRevision ||
        article.currentRevision.id !== article.publishedRevisionId
      )
        throw new Error("未公開の変更があります");
      if (/\{\{monetization:/.test(article.currentRevision.bodyMarkdown))
        throw new Error("既存の配置マーカーがあります");
      const position = suggestAdParagraph(article.currentRevision.bodyMarkdown);
      if (!position)
        throw new Error("条件に合う本文段落がありません。記事編集で位置を指定してください");
      plans.push({ article, ...position });
    } catch (e) {
      skipped.push({
        title: summary.title,
        reason: e instanceof Error ? e.message : "取得できませんでした",
      });
    }
    progress(i + 1);
  }
  return { plans, skipped };
}
/** Leave any partial failure unpublished; the original public end slot remains untouched. */
export async function prepareAdRollout(
  plan: AdRolloutPlan,
  client: Client = api,
): Promise<{ revisionId: string; article: ArticleSummaryDto }> {
  const article = await client.getArticle(plan.article.id);
  const previous = plan.article.currentRevision!;
  if (
    !article.isLive ||
    article.hasUnpublishedChanges ||
    article.currentRevision?.id !== previous.id ||
    article.publishedRevisionId !== previous.id
  )
    throw new Error("プレビュー後に記事が変更されました。再確認してください");
  const { draft } = await client.articleMonetization(article.id);
  if (draft.updatedAt || draft.experimentId || draft.mode !== "ads" || !draft.adsEnabled)
    throw new Error("個別設定が変更されました。記事編集で確認してください");
  const bodyMarkdown = `${previous.bodyMarkdown.slice(0, plan.offset)}\n\n{{monetization:${markerKey}}}\n\n${previous.bodyMarkdown.slice(plan.offset)}`;
  const saved = await client.saveDraft(article.id, {
    ...draftFrom(article),
    bodyMarkdown,
    changeSummary: "広告配置のA/Bテスト用マーカーを追加（本文内容は維持）",
  });
  const config = {
    ...draft,
    placements: [
      ...draft.placements,
      {
        key: markerKey,
        kind: "adsense" as const,
        position: "marker" as const,
        status: "paused" as const,
        adUnit: "7152502134",
        offerId: null,
      },
    ],
  };
  await client.saveArticleMonetization(article.id, config);
  const experiment: AdExperiment = {
    id: adExperimentId(article.id),
    articleId: article.id,
    name: `${article.title.slice(0, 110)} · 末尾 / 本文`,
    markerKey,
    adUnitA: "7152502134",
    adUnitB: "7152502134",
    shareB: 50,
    status: "draft",
    startedAt: null,
    stoppedAt: null,
    updatedAt: null,
  };
  await client.saveAdExperiment(experiment);
  await client.saveArticleMonetization(article.id, { ...config, experimentId: experiment.id });
  await client.controlAdExperiment(experiment.id, "start");
  const check = await client.getArticle(article.id);
  if (
    check.currentRevision?.id !== saved.revision.id ||
    check.currentRevision.bodyMarkdown !== bodyMarkdown
  )
    throw new Error("保存中に記事が変更されました。自動公開せず確認を待ちます");
  return { article: check, revisionId: saved.revision.id };
}
