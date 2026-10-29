import {
  err,
  inlineAffiliateLinks,
  ok,
  publicMonetization,
  validateMonetization,
  type ArticleId,
  type ArticleMonetization,
  type AffiliateOffer,
  type AdExperiment,
  type DomainError,
  type MonetizationSettings,
} from "@tomokichi/domain";
import type { AppContext } from "../../context.js";
import { isAffiliateUrl, isAdExperimentForArticle } from "@tomokichi/contracts";
const invalid = (message: string) => err({ code: "MONETIZATION_INVALID" as const, message });
export async function articleMonetization(ctx: AppContext, id: ArticleId) {
  const article = await ctx.repos.articles.findById(id);
  if (!article) return null;
  const draft = await ctx.repos.monetization.article(id);
  const metadata = article.publishedRevisionId
    ? (await ctx.repos.publicationMetadata.listAll()).find(
        (m) => m.revisionId === article.publishedRevisionId,
      )?.metadata
    : null;
  return {
    draft,
    published: metadata?.monetization ?? null,
    needsPublication: article.currentRevisionId !== article.publishedRevisionId,
  };
}
export async function saveArticleMonetization(
  ctx: AppContext,
  id: ArticleId,
  config: ArticleMonetization,
) {
  const article = await ctx.repos.articles.findById(id);
  if (!article || article.kind !== "article") return invalid("対象の記事がありません");
  const revision = article.currentRevisionId
    ? await ctx.repos.revisions.findById(article.currentRevisionId)
    : null;
  const settings = await ctx.repos.monetization.settings();
  const errors = validateMonetization(config, revision?.bodyMarkdown ?? "", settings);
  if (errors.length) return err(...errors);
  const offers = await ctx.repos.monetization.offers();
  if (
    config.placements.some(
      (p) => p.offerId && (p.kind !== "affiliate" || !offers.some((o) => o.id === p.offerId)),
    )
  )
    return invalid("案件の参照が不正です");
  if (config.experimentId) {
    const experiment = (await ctx.repos.monetization.experiments()).find(
      (e) => e.id === config.experimentId,
    );
    if (!experiment || experiment.articleId !== id)
      return invalid("他の記事または存在しない実験は選択できません");
  }
  const saved = { ...config, updatedAt: ctx.clock.now() };
  await ctx.repos.monetization.saveArticle(id, saved, {
    revisionId: ctx.ids.next(),
    now: ctx.clock.now(),
  });
  return ok(saved);
}
export async function saveMonetizationSettings(ctx: AppContext, settings: MonetizationSettings) {
  if (
    settings.maxAds !== 1 ||
    !settings.adUnits.some((unit) => unit.id === "7152502134") ||
    new Set(settings.adUnits.map((u) => u.id)).size !== settings.adUnits.length
  )
    return invalid(
      "機能フラグ・広告ユニット・上限を確認してください。既存記事用ユニット7152502134は維持してください",
    );
  const configs = await ctx.repos.monetization.listArticles();
  if (
    configs.some((c) =>
      c.config.placements.some(
        (p) => p.kind === "adsense" && !settings.adUnits.some((u) => u.id === p.adUnit),
      ),
    )
  )
    return invalid("使用中の広告ユニットは削除できません");
  const experiments = await ctx.repos.monetization.experiments();
  if (
    experiments.some(
      (e) =>
        !settings.adUnits.some((u) => u.id === e.adUnitA) ||
        !settings.adUnits.some((u) => u.id === e.adUnitB),
    )
  )
    return invalid("実験で使用中の広告ユニットは削除できません");
  const saved = { ...settings, updatedAt: ctx.clock.now() };
  const previous = await ctx.repos.monetization.settings();
  const affected =
    previous.affiliateEnabled !== saved.affiliateEnabled
      ? configs.filter((a) => a.config.placements.some((p) => p.kind === "affiliate"))
      : [];
  await ctx.repos.monetization.saveSettings(
    saved,
    affected.map((a) => ({
      articleId: a.articleId as ArticleId,
      revisionId: ctx.ids.next(),
      now: ctx.clock.now(),
    })),
  );
  return ok(saved);
}
export async function saveAffiliateOffer(ctx: AppContext, offer: AffiliateOffer) {
  const old = (await ctx.repos.monetization.offers()).find((o) => o.id === offer.id);
  if (old?.status === "archived" && offer.status !== "archived")
    return invalid("アーカイブした案件は再開できません。新しい案件を作成してください");
  if (
    offer.publicationApproved &&
    (offer.status !== "ready" ||
      !offer.checkedAt ||
      !offer.heading.trim() ||
      !["text", "booking_card"].includes(offer.format) ||
      !isAffiliateUrl(offer.provider, offer.url))
  )
    return invalid(
      "公開承認には掲載準備済み・確認日時・見出し・正式な提携URL・対応表示形式が必要です",
    );
  const saved = { ...offer, updatedAt: ctx.clock.now() };
  const affected = (await ctx.repos.monetization.listArticles()).filter((a) =>
    a.config.placements.some((p) => p.offerId === offer.id),
  );
  await ctx.repos.monetization.saveOffer(
    saved,
    affected.map((a) => ({
      articleId: a.articleId as ArticleId,
      revisionId: ctx.ids.next(),
      now: ctx.clock.now(),
    })),
  );
  return ok(saved);
}
export async function saveAdExperiment(
  ctx: AppContext,
  experiment: AdExperiment,
  action?: "start" | "stop",
) {
  if (!isAdExperimentForArticle(experiment.id, experiment.articleId))
    return invalid("実験IDと対象記事が一致しません");
  const article = await ctx.repos.articles.findById(experiment.articleId as ArticleId);
  if (!article || article.kind !== "article") return invalid("対象の記事がありません");
  const repo = ctx.repos.monetization;
  const experiments = await repo.experiments();
  const old = experiments.find((e) => e.id === experiment.id);
  if (old && old.articleId !== experiment.articleId)
    return invalid("実験の対象記事は変更できません");
  if (
    action === "start" &&
    experiments.some(
      (e) =>
        e.id !== experiment.id && e.articleId === experiment.articleId && e.status === "running",
    )
  )
    return invalid("同じ記事で同時に複数の実験は開始できません");
  if (
    !action &&
    (experiment.status !== "draft" || old?.status === "running" || old?.status === "stopped")
  )
    return invalid("開始・停止は専用の操作を使用してください。実施後の実験条件は変更できません");
  if (action && !old) return invalid("先に実験を保存してください");
  if (action === "start" && old?.status !== "draft") return invalid("下書きの実験だけ開始できます");
  if (action === "stop" && old?.status !== "running")
    return invalid("実施中の実験だけ停止できます");
  const settings = await repo.settings();
  if (
    ![experiment.adUnitA, experiment.adUnitB].every((u) => settings.adUnits.some((s) => s.id === u))
  )
    return invalid("未登録の広告ユニットです");
  if (action === "start") {
    if (!settings.placementsEnabled || !settings.experimentsEnabled || !settings.adsEnabled)
      return invalid("サイトの広告配置と実験フラグを有効にしてください");
    const config = await repo.article(experiment.articleId as ArticleId);
    if (
      config.experimentId !== experiment.id ||
      !config.adsEnabled ||
      !["ads", "hybrid"].includes(config.mode)
    )
      return invalid("記事編集で実験への参加を保存してください");
    const errors = await validateArticleMonetization(ctx, experiment.articleId as ArticleId, {
      ...experiment,
      status: "running",
    });
    if (errors.length) return err(...errors);
  }
  const now = ctx.clock.now();
  const saved: AdExperiment = {
    ...(action ? old! : experiment),
    status: action === "start" ? "running" : action === "stop" ? "stopped" : "draft",
    startedAt: action === "start" ? now : (old?.startedAt ?? null),
    stoppedAt: action === "stop" ? now : null,
    updatedAt: now,
  };
  await repo.saveExperiment(saved, { revisionId: ctx.ids.next(), now });
  return ok(saved);
}
export async function validateArticleMonetization(
  ctx: AppContext,
  id: ArticleId,
  override?: AdExperiment,
) {
  const article = await ctx.repos.articles.findById(id);
  if (!article || article.kind !== "article") return [];
  const revision = article.currentRevisionId
    ? await ctx.repos.revisions.findById(article.currentRevisionId)
    : null;
  const config = await ctx.repos.monetization.article(id);
  const settings = await ctx.repos.monetization.settings();
  const errors = validateMonetization(config, revision?.bodyMarkdown ?? "", settings);
  errors.push(
    ...unbackedInlineAffiliates(
      config,
      await ctx.repos.monetization.offers(),
      revision?.bodyMarkdown ?? "",
    ),
  );
  const experiment =
    override ??
    (await ctx.repos.monetization.experiments()).find((e) => e.id === config.experimentId);
  if (experiment?.status === "running") {
    const b: ArticleMonetization = {
      ...config,
      placements: [
        {
          key: experiment.markerKey,
          kind: "adsense",
          position: "marker",
          status: "ready",
          adUnit: experiment.adUnitB,
          offerId: null,
        },
      ],
    };
    errors.push(...validateMonetization(b, revision?.bodyMarkdown ?? "", settings));
  }
  return errors;
}
export async function projectArticleMonetization(ctx: AppContext, id: ArticleId) {
  const config = await ctx.repos.monetization.article(id);
  return publicMonetization(
    id,
    config,
    await ctx.repos.monetization.settings(),
    (await ctx.repos.monetization.experiments()).find((e) => e.id === config.experimentId) ?? null,
    await ctx.repos.monetization.offers(),
  );
}

/**
 * An inline affiliate link the page cannot back with an approved offer of
 * this article is printed there as plain text, so publishing refuses it
 * rather than letting it quietly lose its link.
 */
function unbackedInlineAffiliates(
  config: ArticleMonetization,
  offers: readonly AffiliateOffer[],
  markdown: string,
): DomainError[] {
  const approved = new Set(
    config.placements.flatMap((placement) => {
      if (placement.kind !== "affiliate" || placement.status !== "ready") return [];
      const offer = offers.find((o) => o.id === placement.offerId);
      return offer?.url && offer.status === "ready" && offer.publicationApproved ? [offer.url] : [];
    }),
  );
  return [...new Set(inlineAffiliateLinks(markdown))]
    .filter((url) => !approved.has(url))
    .map((url) => ({
      code: "MONETIZATION_INVALID" as const,
      field: "monetization",
      message: `本文の広告リンクが、この記事の承認済みアフィリエイト案件と一致しません: ${url}`,
    }));
}
