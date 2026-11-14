import {
  archiveArticle,
  auditArticleBodies,
  createArticle,
  publishArticle,
  scheduleArticle,
  setArticleExperienceTags,
  setArticleMedia,
  unpublishArticle,
  updateArticleDraft,
} from "@tomokichi/application";
import {
  parseInstant,
  RouteTable,
  type ArticleId,
  type CategoryId,
  type CollectionId,
  type ExperienceTag,
  type LocationId,
  type MediaId,
  type PlaceId,
  type TagId,
} from "@tomokichi/domain";
import { toRevisionDto } from "../../mappers.js";
import { invalid, notFound, unwrap, type Handlers } from "../scope.js";
import { contentDetail, listContent, publishCheck, requireContent, siteAuthor } from "./content.js";

type Names =
  | "article.list"
  | "article.get"
  | "article.create"
  | "article.saveDraft"
  | "article.publishCheck"
  | "article.publish"
  | "article.unpublish"
  | "article.archive"
  | "article.schedule"
  | "article.setRelations"
  | "article.setExperienceTags"
  | "article.setMedia"
  | "article.bodyAudit";

export const articleHandlers: Handlers<Names> = {
  "article.list": ({ ctx }, { query }) =>
    listContent(ctx, (article) => article.kind !== "note", query),

  "article.get": async (scope, { articleId }) =>
    contentDetail(scope, await requireContent(scope.ctx, articleId, "article")),

  "article.create": async ({ ctx, env }, input) => {
    const created = unwrap(
      await createArticle(ctx, {
        slug: input.slug,
        locale: "ja",
        kind: input.kind,
        authorId: await siteAuthor(ctx),
        path: input.path,
        draft: {
          title: input.title,
          summary: input.summary,
          bodyMarkdown: input.bodyMarkdown,
          seoTitleOverride: input.seoTitleOverride,
          seoDescriptionOverride: input.seoDescriptionOverride,
          changeSummary: input.changeSummary,
          journeyIds: input.journeyIds as readonly CollectionId[] | undefined,
        },
        imageBase: env.PUBLIC_IMAGE_URL,
      }),
    );
    return { id: created.article.id };
  },

  // Fields left out keep what the current revision has, so a caller can change
  // the body without restating the title.
  "article.saveDraft": async ({ ctx, env }, input) => {
    const article = await requireContent(ctx, input.articleId, "article");
    const current = article.currentRevisionId
      ? await ctx.repos.revisions.findById(article.currentRevisionId)
      : null;
    const saved = unwrap(
      await updateArticleDraft(
        ctx,
        article.id,
        {
          title: input.title ?? current?.title ?? "",
          summary: input.summary ?? current?.summary ?? "",
          bodyMarkdown: input.bodyMarkdown ?? current?.bodyMarkdown ?? "",
          seoTitleOverride:
            input.seoTitleOverride === undefined
              ? (current?.seoTitleOverride ?? null)
              : input.seoTitleOverride,
          seoDescriptionOverride:
            input.seoDescriptionOverride === undefined
              ? (current?.seoDescriptionOverride ?? null)
              : input.seoDescriptionOverride,
          changeSummary: input.changeSummary ?? null,
          journeyIds: input.journeyIds as readonly CollectionId[] | undefined,
        },
        article.authorId,
        env.PUBLIC_IMAGE_URL,
      ),
    );
    return { revision: toRevisionDto(saved.revision) };
  },

  "article.publishCheck": async ({ ctx }, { articleId }) =>
    publishCheck(ctx, (await requireContent(ctx, articleId, "article")).id),

  "article.publish": async (scope, { articleId, deferBuild }) => {
    const article = await requireContent(scope.ctx, articleId, "article");
    const published = unwrap(await publishArticle(scope.ctx, article.id));
    return { status: published.status, publication: await scope.publishSite(deferBuild) };
  },

  "article.unpublish": async (scope, { articleId }) => {
    const article = await requireContent(scope.ctx, articleId, "article");
    const result = unwrap(await unpublishArticle(scope.ctx, article.id));
    return { status: result.status, publication: await scope.publishSite() };
  },

  "article.archive": async (scope, { articleId }) => {
    const article = await requireContent(scope.ctx, articleId, "article");
    const result = unwrap(await archiveArticle(scope.ctx, article.id));
    return { status: result.status, publication: await scope.publishSite() };
  },

  "article.schedule": async ({ ctx }, { articleId, at }) => {
    const article = await requireContent(ctx, articleId, "article");
    const scheduled = unwrap(await scheduleArticle(ctx, article.id, unwrap(parseInstant(at))));
    return { status: scheduled.status };
  },

  // Each list replaces what the article had; a list left out is not touched.
  "article.setRelations": async ({ ctx }, input) => {
    const articleId = input.articleId as ArticleId;
    if (!(await ctx.repos.articles.findById(articleId)))
      throw notFound("ARTICLE_NOT_FOUND", `no article ${articleId}`);
    if (input.collectionIds) {
      // Checked before anything is written, so a bad id never half-saves.
      const known = new Map(
        (await ctx.repos.collections.listAll()).map((item) => [item.id, item.kind]),
      );
      const unknown = input.collectionIds.find((id) => !known.has(id as CollectionId));
      if (unknown) throw notFound("COLLECTION_NOT_FOUND", `no collection ${unknown}`);
      if (input.collectionIds.some((id) => known.get(id as CollectionId) === "journey"))
        throw invalid("旅程は記事の下書きの journeyIds で設定してください", "collectionIds");
    }
    const mine = <T extends { articleId: string }>(rows: readonly T[]) =>
      rows.filter((row) => row.articleId === articleId);
    const [locations, places, categories, tags] = await Promise.all([
      input.locations ? null : ctx.repos.relations.listArticleLocations(),
      input.places ? null : ctx.repos.relations.listArticlePlaces(),
      input.categoryIds ? null : ctx.repos.relations.listArticleCategories(),
      input.tagIds ? null : ctx.repos.relations.listArticleTags(),
    ]);
    await ctx.repos.relations.replaceForArticle(articleId, {
      locations:
        input.locations?.map((r) => ({
          articleId,
          locationId: r.locationId as LocationId,
          relation: r.relation,
        })) ?? mine(locations ?? []),
      places:
        input.places?.map((r) => ({
          articleId,
          placeId: r.placeId as PlaceId,
          relation: r.relation,
        })) ?? mine(places ?? []),
      categories:
        input.categoryIds?.map((id) => ({ articleId, categoryId: id as CategoryId })) ??
        mine(categories ?? []),
      tags: input.tagIds?.map((id) => ({ articleId, tagId: id as TagId })) ?? mine(tags ?? []),
    });
    if (input.collectionIds) {
      // sort_order is the article's place inside each collection. Keep what is
      // stored; a new membership starts at 0 and the site orders ties by trip
      // and publication date.
      const previous = new Map(
        (await ctx.repos.collections.listMemberships())
          .filter((m) => m.articleId === articleId)
          .map((m) => [m.collectionId, m.sortOrder]),
      );
      await ctx.repos.collections.replaceSeriesForArticle(
        articleId,
        [...new Set(input.collectionIds)].map((id) => ({
          articleId,
          collectionId: id as CollectionId,
          sortOrder: previous.get(id as CollectionId) ?? 0,
        })),
      );
    }
    return { ok: true };
  },

  "article.setExperienceTags": async ({ ctx }, { articleId, experienceTags }) => {
    const article = await requireContent(ctx, articleId, "article");
    const saved = unwrap(
      await setArticleExperienceTags(ctx, article.id, experienceTags as ExperienceTag[]),
    );
    return { experienceTags: saved.experienceTags };
  },

  "article.setMedia": async ({ ctx }, { articleId, media }) => {
    const id = articleId as ArticleId;
    unwrap(
      await setArticleMedia(
        ctx,
        id,
        media.map((usage) => ({
          articleId: id,
          mediaId: usage.mediaId as MediaId,
          role: usage.role,
          sortOrder: usage.sortOrder,
          alt: usage.alt,
          caption: usage.caption,
        })),
      ),
    );
    return { ok: true };
  },

  "article.bodyAudit": async ({ ctx }) => {
    const table = new RouteTable(await ctx.repos.routes.listAll());
    const findings = await auditArticleBodies(ctx);
    return {
      items: findings.map((finding) => ({
        id: finding.article.id,
        slug: finding.article.slug,
        status: finding.article.status,
        title: finding.title,
        path:
          table.canonicalFor(
            finding.article.kind === "page" ? "static" : "article",
            finding.article.id,
          )?.path ?? null,
        disallowedHtml: finding.disallowedHtml,
        inlineInternalLinks: finding.inlineInternalLinks,
        ineffectiveBold: finding.ineffectiveBold,
      })),
      total: findings.length,
    };
  },
};
