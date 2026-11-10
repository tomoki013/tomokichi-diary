import {
  articleMonetization,
  checkPublishable,
  saveAdExperiment,
  saveAffiliateOffer,
  saveArticleMonetization,
  saveMonetizationSettings,
  updateArticleDraft,
  validateArticleMonetization,
  type AppContext,
} from "@tomokichi/application";
import {
  affiliateOfferSchema,
  applyLayout,
  bodyAdFits,
  defaultCondition,
  insertMarker,
  markerKeys,
  nextExperimentId,
  positionB,
  suggestAdParagraph,
  validate,
  type AdExperiment,
  type AffiliateOffer,
  type ArticleMonetization,
  type MonetizationOverviewDto,
  type MonetizationSettings,
} from "@tomokichi/contracts";
import {
  hasUnpublishedChanges,
  isPubliclyVisible,
  type Article,
  type ArticleId,
  type ArticleRevision,
} from "@tomokichi/domain";
import { invalid, notFound, OpError, unwrap, unwrapAs, type Handlers } from "../scope.js";

type Names =
  | "ads.overview"
  | "ads.saveSettings"
  | "ads.article"
  | "ads.saveArticle"
  | "ads.validateArticle"
  | "ads.setLayout"
  | "ads.moveBodyAds"
  | "ads.startTest"
  | "ads.saveExperiment"
  | "ads.controlExperiment"
  | "offer.create"
  | "offer.update"
  | "offer.archive";

const refuse = (message: string) => new OpError("MONETIZATION_INVALID", message, 409);

async function overview(ctx: AppContext): Promise<MonetizationOverviewDto> {
  const repos = ctx.repos;
  const [configs, offers, experiments, articles, metadata, settings] = await Promise.all([
    repos.monetization.listArticles(),
    repos.monetization.offers(),
    repos.monetization.experiments(),
    repos.articles.listAll(),
    repos.publicationMetadata.listAll(),
    repos.monetization.settings(),
  ]);
  const published = new Map(metadata.map((m) => [m.revisionId, m.metadata.monetization]));
  const articleById = new Map(articles.map((article) => [article.id as string, article]));
  const now = ctx.clock.now();
  const showsAds = (article: Article) => {
    if (!article.publishedRevisionId) return false;
    const live = published.get(article.publishedRevisionId);
    // A snapshot from before monetization metadata shows the default ad.
    return live ? Boolean(live.enabled && (live.placement || live.experiment)) : true;
  };
  return {
    publishedAdArticles: articles.filter(
      (a) => a.kind === "article" && isPubliclyVisible(a, now) && showsAds(a),
    ).length,
    settings,
    articles: configs.map((item) => {
      const article = articleById.get(item.articleId);
      return {
        ...item,
        published: article?.publishedRevisionId
          ? (published.get(article.publishedRevisionId) ?? null)
          : null,
        needsPublication: article
          ? article.currentRevisionId !== article.publishedRevisionId
          : false,
      };
    }),
    offers,
    experiments,
  };
}

/**
 * The article as an ad change needs it: live, with nothing unpublished, so
 * publishing the ad change never publishes someone's unrelated edits with it.
 */
async function liveArticle(
  ctx: AppContext,
  articleId: string,
): Promise<{ article: Article; revision: ArticleRevision; draft: ArticleMonetization }> {
  const article = await ctx.repos.articles.findById(articleId as ArticleId);
  if (!article || article.kind !== "article")
    throw notFound("ARTICLE_NOT_FOUND", `記事 ${articleId} が見つかりません`);
  const revision = article.currentRevisionId
    ? await ctx.repos.revisions.findById(article.currentRevisionId)
    : null;
  if (!revision || !isPubliclyVisible(article, ctx.clock.now()) || hasUnpublishedChanges(article))
    throw refuse("公開中の最新版ではありません。記事編集で確認してください");
  const monetization = await articleMonetization(ctx, article.id);
  if (!monetization) throw notFound("ARTICLE_NOT_FOUND", `記事 ${articleId} が見つかりません`);
  return { article, revision, draft: monetization.draft };
}

/** Saves a new revision that differs from the current one only in its body. */
async function saveBody(
  ctx: AppContext,
  imageBase: string | undefined,
  article: Article,
  revision: ArticleRevision,
  bodyMarkdown: string,
  changeSummary: string,
): Promise<void> {
  unwrap(
    await updateArticleDraft(
      ctx,
      article.id,
      {
        title: revision.title,
        summary: revision.summary,
        bodyMarkdown,
        seoTitleOverride: revision.seoTitleOverride,
        seoDescriptionOverride: revision.seoDescriptionOverride,
        changeSummary,
      },
      article.authorId,
      imageBase,
    ),
  );
}

/**
 * Moves each named body marker to the paragraph the ad standard would pick
 * (`suggestAdParagraph`), one at a time, so the body keeps every word and only
 * the `{{monetization:key}}` lines change place.
 */
export function moveBodyMarkers(
  body: string,
  keys: readonly string[],
): { body: string; moved: { key: string; after: string }[]; unmovable: string[] } {
  let next = body;
  const moved: { key: string; after: string }[] = [];
  const unmovable: string[] = [];
  for (const key of keys) {
    const line = new RegExp(`\\n*^\\{\\{monetization:${key}\\}\\}[ \\t]*$\\n*`, "m");
    if (!line.test(next)) {
      unmovable.push(key);
      continue;
    }
    const without = next.replace(line, "\n\n").replace(/^\n+/, "");
    const spot = suggestAdParagraph(without);
    if (!spot) {
      unmovable.push(key);
      continue;
    }
    next = insertMarker(without, spot.offset, key);
    moved.push({ key, after: spot.excerpt });
  }
  return { body: next, moved, unmovable };
}

/** Marker keys the publish check rejects for where they sit in the body. */
export function misplacedMarkerKeys(
  problems: readonly { code: string; message: string }[],
): string[] {
  return problems.flatMap((problem) => {
    const key =
      problem.code === "MONETIZATION_INVALID" && /^配置 ([a-z0-9-]+) は/.exec(problem.message);
    return key ? [key[1]!] : [];
  });
}

export const monetizationHandlers: Handlers<Names> = {
  "ads.overview": ({ ctx }) => overview(ctx),

  "ads.saveSettings": async ({ ctx }, { settings }) =>
    unwrapAs<MonetizationSettings>(await saveMonetizationSettings(ctx, settings)),

  "ads.article": async ({ ctx }, { articleId }) => {
    const [monetization, settings, experiments] = await Promise.all([
      articleMonetization(ctx, articleId as ArticleId),
      ctx.repos.monetization.settings(),
      ctx.repos.monetization.experiments(),
    ]);
    if (!monetization) throw notFound("ARTICLE_NOT_FOUND", "記事がありません");
    return {
      adUnits: settings.adUnits,
      ...monetization,
      experiments: experiments.filter((experiment) => experiment.articleId === articleId),
    };
  },

  "ads.saveArticle": async ({ ctx }, { articleId, config }) =>
    unwrapAs<ArticleMonetization>(
      await saveArticleMonetization(ctx, articleId as ArticleId, config),
    ),

  "ads.validateArticle": async ({ ctx }, { articleId }) => ({
    problems: await validateArticleMonetization(ctx, articleId as ArticleId),
  }),

  /*
   * Brings one live article to a layout and leaves it ready to publish. A
   * body with no qualifying paragraph gets the end ad only.
   */
  "ads.setLayout": async ({ ctx, env }, { articleId, layout }) => {
    const { article, revision, draft } = await liveArticle(ctx, articleId);
    const experiment =
      (await ctx.repos.monetization.experiments()).find(
        (e) => e.articleId === article.id && e.status === "running",
      ) ?? null;
    const body = revision.bodyMarkdown;
    let plan = applyLayout(layout, draft, body, experiment);
    if ("error" in plan) {
      plan = applyLayout("end-only", draft, body, experiment);
      if ("error" in plan) throw refuse(plan.error);
      // An unconfigured article already shows the end ad; record the choice once.
      const rest = plan.changes.filter((change) => change !== "記事末尾の広告を表示");
      plan.changes =
        rest.length || !draft.updatedAt ? [...rest, "本文に置ける段落がないため末尾のみ"] : [];
    }
    if (plan.changes.length === 0) return { changes: [], hasUnpublishedChanges: false };
    // Body, then configuration, then the test: a failure part-way leaves an
    // unpublished draft to finish in the editor, never a half-ended test.
    if (plan.body !== body)
      await saveBody(
        ctx,
        env.PUBLIC_IMAGE_URL,
        article,
        revision,
        plan.body,
        "広告配置を揃える（本文内容は維持）",
      );
    unwrapAs<ArticleMonetization>(await saveArticleMonetization(ctx, article.id, plan.config));
    if (plan.stopExperiment && experiment)
      unwrapAs<AdExperiment>(await saveAdExperiment(ctx, experiment, "stop"));
    return { changes: plan.changes, hasUnpublishedChanges: true };
  },

  "ads.moveBodyAds": async ({ ctx, env }, { articleId }) => {
    const article = await ctx.repos.articles.findById(articleId as ArticleId);
    const revision = article?.currentRevisionId
      ? await ctx.repos.revisions.findById(article.currentRevisionId)
      : null;
    if (!article || !revision) throw notFound("ARTICLE_NOT_FOUND", `no article ${articleId}`);
    const keys = misplacedMarkerKeys(await checkPublishable(ctx, article.id));
    const result = moveBodyMarkers(revision.bodyMarkdown, keys);
    if (result.moved.length > 0)
      await saveBody(
        ctx,
        env.PUBLIC_IMAGE_URL,
        article,
        revision,
        result.body,
        "本文中の広告位置を公開ルールに合わせる（本文内容は維持）",
      );
    return { moved: result.moved, unmovable: result.unmovable };
  },

  /*
   * Starts a position test on one article and leaves it ready to publish. A's
   * body ad is the article's own (added by the standard rule when missing);
   * B's marker is added at `positionB`. Both pass the publish check's rule.
   */
  "ads.startTest": async ({ ctx, env }, input) => {
    const { article, revision, draft } = await liveArticle(ctx, input.articleId);
    const [settings, experiments] = await Promise.all([
      ctx.repos.monetization.settings(),
      ctx.repos.monetization.experiments(),
    ]);
    const adsOn = !draft.updatedAt || (draft.adsEnabled && ["ads", "hybrid"].includes(draft.mode));
    if (
      article.noindex ||
      !adsOn ||
      experiments.some(
        (e) => e.articleId === article.id && (e.status === "running" || e.status === "draft"),
      )
    )
      throw refuse("公開中で未公開の変更がなく、テスト中でない記事だけで始められます");
    const base = defaultCondition(settings.adUnits[0]?.id);
    const condition = {
      ...base,
      adUnitA: input.adUnitA ?? base.adUnitA,
      adUnitB: input.adUnitB ?? base.adUnitB,
      shareB: input.shareB ?? base.shareB,
      ...(input.afterText ? { afterText: input.afterText } : {}),
    };
    const plan = applyLayout("standard", draft, revision.bodyMarkdown, null);
    if ("error" in plan) throw refuse(plan.error);
    const bodyAd = plan.config.placements.find(
      (p) => p.kind === "adsense" && p.position === "marker" && p.status === "ready",
    );
    if (!bodyAd || !bodyAdFits(plan.body, bodyAd.key))
      throw refuse("本文中の広告の位置を記事編集で確認してください");
    const spot = positionB(plan.body, bodyAd.key, condition.afterText);
    if (!spot)
      throw refuse(
        condition.afterText
          ? "指定した段落の後には公開ルール上置けません"
          : "Bの本文中の広告を置ける別の段落がありません",
      );
    const present = new Set(markerKeys(plan.body));
    const bKey = ["body-ad-b", "body-ad-b-2", "body-ad-b-3"].find((key) => !present.has(key));
    if (!bKey) throw refuse("Bの本文中の広告の位置を記事編集で確認してください");
    const nextBody = insertMarker(plan.body, spot.offset, bKey);
    if (!bodyAdFits(nextBody, bKey) || !bodyAdFits(nextBody, bodyAd.key))
      throw refuse("Bの本文中の広告の位置を記事編集で確認してください");
    if (nextBody !== revision.bodyMarkdown)
      await saveBody(
        ctx,
        env.PUBLIC_IMAGE_URL,
        article,
        revision,
        nextBody,
        "広告の位置テスト用に本文中の広告の候補位置を追加（本文内容は維持）",
      );
    const experiment: AdExperiment = {
      id: nextExperimentId(article.id, experiments),
      articleId: article.id,
      name: `${condition.name} · ${revision.title}`.slice(0, 150),
      markerKey: bKey,
      markerKeyA: bodyAd.key,
      adUnitA: condition.adUnitA,
      adUnitB: condition.adUnitB,
      shareB: condition.shareB,
      status: "draft",
      startedAt: null,
      stoppedAt: null,
      updatedAt: null,
    };
    const saved = unwrapAs<AdExperiment>(await saveAdExperiment(ctx, experiment));
    // B's marker is configured but paused: only one body ad is "ready" outside
    // the test, and the test itself shows each arm its own.
    unwrapAs<ArticleMonetization>(
      await saveArticleMonetization(ctx, article.id, {
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
      }),
    );
    unwrapAs<AdExperiment>(await saveAdExperiment(ctx, saved, "start"));
    return { experimentId: experiment.id, hasUnpublishedChanges: true };
  },

  "ads.saveExperiment": async ({ ctx }, { experiment }) =>
    unwrapAs<AdExperiment>(await saveAdExperiment(ctx, experiment)),

  "ads.controlExperiment": async ({ ctx }, { experimentId, action }) => {
    const experiment = (await ctx.repos.monetization.experiments()).find(
      (e) => e.id === experimentId,
    );
    if (!experiment) throw notFound("API_NOT_FOUND", "実験がありません");
    return unwrapAs<AdExperiment>(await saveAdExperiment(ctx, experiment, action));
  },

  "offer.create": async ({ ctx }, { offer }) => {
    if (typeof offer !== "object" || offer === null || Array.isArray(offer))
      throw invalid("案件を確認してください", "offer");
    const parsed = validate(affiliateOfferSchema, { ...offer, id: ctx.ids.next() });
    if (!parsed.ok) throw new OpError(parsed.code, "案件を確認してください", 400, parsed.issues);
    return unwrapAs<AffiliateOffer>(await saveAffiliateOffer(ctx, parsed.value));
  },

  "offer.update": async ({ ctx }, { offer }) =>
    unwrapAs<AffiliateOffer>(await saveAffiliateOffer(ctx, offer)),

  // Removal is archival, so every existing placement stays assignable.
  "offer.archive": async ({ ctx }, { offerId }) => {
    const offer = (await ctx.repos.monetization.offers()).find((o) => o.id === offerId);
    if (!offer) throw notFound("API_NOT_FOUND", "案件がありません");
    return unwrapAs<AffiliateOffer>(
      await saveAffiliateOffer(ctx, { ...offer, publicationApproved: false, status: "archived" }),
    );
  },
};
