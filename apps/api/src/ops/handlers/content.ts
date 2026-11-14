import {
  checkPublishable,
  linkBodyImages,
  listArticlesForAdmin,
  membershipsByArticle,
  resolveJourneyMemberships,
  type AppContext,
} from "@tomokichi/application";
import type { ArticleDetailDto, ArticleListDto, PublishCheckDto } from "@tomokichi/contracts";
import {
  hasUnpublishedChanges,
  isPubliclyVisible,
  RouteTable,
  type Article,
  type ArticleId,
  type AuthorId,
} from "@tomokichi/domain";
import { toArticleMediaDto, toArticleSummaryDto, toRevisionDto } from "../../mappers.js";
import { notFound, OpError, type OpScope } from "../scope.js";

/** What articles, pages and diary notes share: they are one entity with a `kind`. */

const routeKind = (article: Pick<Article, "kind">) =>
  article.kind === "page" ? "static" : "article";

function groupBy<T>(rows: readonly T[], key: (row: T) => string, value: (row: T) => string) {
  const map = new Map<string, string[]>();
  for (const row of rows) map.set(key(row), [...(map.get(key(row)) ?? []), value(row)]);
  return map;
}

/**
 * The site has one author, whose id is whatever the data says it is. Multi-
 * author support is a data change; until then a new article is theirs.
 */
export async function siteAuthor(ctx: AppContext): Promise<AuthorId> {
  const [author] = await ctx.repos.authors.listAll();
  if (!author) throw new OpError("API_INTERNAL", "no author is on record", 500);
  return author.id;
}

export async function listContent(
  ctx: AppContext,
  include: (article: Article) => boolean,
  query = "",
): Promise<ArticleListDto> {
  const summaries = (await listArticlesForAdmin(ctx)).filter(({ article }) => include(article));
  const [routeList, memberships, collections, categories, locations] = await Promise.all([
    ctx.repos.routes.listAll(),
    ctx.repos.collections.listMemberships(),
    ctx.repos.collections.listAll(),
    ctx.repos.relations.listArticleCategories(),
    ctx.repos.relations.listArticleLocations(),
  ]);
  const knownJourneys = new Set(collections.filter((c) => c.kind === "journey").map((c) => c.id));
  const groupedMemberships = membershipsByArticle(memberships);
  const categoryIds = groupBy(
    categories,
    (row) => row.articleId,
    (row) => row.categoryId,
  );
  const locationIds = groupBy(
    locations,
    (row) => row.articleId,
    (row) => row.locationId,
  );
  const table = new RouteTable(routeList);
  const items = summaries.map((summary) =>
    toArticleSummaryDto({
      article: summary.article,
      title: summary.title,
      path: table.canonicalFor(routeKind(summary.article), summary.article.id)?.path ?? null,
      hasUnpublishedChanges: summary.hasUnpublishedChanges,
      isLive: summary.isLive,
      contentUpdatedAt: summary.contentUpdatedAt,
      collectionIds: resolveJourneyMemberships(
        groupedMemberships.get(summary.article.id) ?? [],
        summary.article.id,
        summary.journeyIds,
        knownJourneys,
      ).map((row) => row.collectionId),
      categoryIds: categoryIds.get(summary.article.id) ?? [],
      locationIds: locationIds.get(summary.article.id) ?? [],
    }),
  );
  const needle = query.trim().toLowerCase();
  const matching =
    needle === ""
      ? items
      : items.filter((item) =>
          [item.title, item.slug, item.path ?? "", item.id].some((text) =>
            text.toLowerCase().includes(needle),
          ),
        );
  return { items: matching, total: matching.length };
}

/** The article, or the 404 that names which tool reads the other kind. */
export async function requireContent(
  ctx: AppContext,
  id: string,
  want: "article" | "note",
): Promise<Article> {
  const article = await ctx.repos.articles.findById(id as ArticleId);
  if (!article) throw notFound("ARTICLE_NOT_FOUND", `no article ${id}`);
  const isNote = article.kind === "note";
  if (want === "note" && !isNote)
    throw notFound("ARTICLE_NOT_FOUND", `一言日記が見つかりません: ${id}`);
  if (want === "article" && isNote)
    throw new OpError(
      "API_VALIDATION_FAILED",
      "一言日記には一言日記用の操作（get_diary_note など）を使ってください",
      400,
    );
  return article;
}

export async function contentDetail(scope: OpScope, article: Article): Promise<ArticleDetailDto> {
  const { ctx, env } = scope;
  const id = article.id;
  const revision = article.currentRevisionId
    ? await ctx.repos.revisions.findById(article.currentRevisionId)
    : null;
  const table = new RouteTable(await ctx.repos.routes.listAll());
  const usages = await ctx.repos.media.listForArticle(id);
  const assets = await Promise.all(usages.map((usage) => ctx.repos.media.findById(usage.mediaId)));
  const body = revision?.bodyMarkdown ?? "";
  const bodyUrls = new Map(
    linkBodyImages(
      body,
      assets.filter((asset) => asset !== null),
      body.includes("/v1/images/") ? await ctx.repos.media.listSlugAliases() : [],
      { resolve: (key) => ctx.mediaUrls.resolve(key) },
    ).images.map((image) => [image.asset.id as string, image.urls]),
  );
  const [locations, places, categories, tags, memberships, collections, noteRelated] =
    await Promise.all([
      ctx.repos.relations.listArticleLocations(),
      ctx.repos.relations.listArticlePlaces(),
      ctx.repos.relations.listArticleCategories(),
      ctx.repos.relations.listArticleTags(),
      ctx.repos.collections.listMemberships(),
      ctx.repos.collections.listAll(),
      ctx.repos.relations.listNoteRelatedArticles(),
    ]);
  return {
    ...toArticleSummaryDto({
      article,
      title: revision?.title ?? "",
      path: table.canonicalFor(routeKind(article), id)?.path ?? null,
      hasUnpublishedChanges: hasUnpublishedChanges(article),
      isLive: isPubliclyVisible(article, ctx.clock.now()),
    }),
    currentRevision: revision ? toRevisionDto(revision) : null,
    publishedRevisionId: article.publishedRevisionId,
    travelStartDate: article.travelStartDate,
    travelEndDate: article.travelEndDate,
    experienceTags: article.experienceTags,
    media: usages.map((usage, index) => ({
      ...toArticleMediaDto(
        usage,
        assets[index] ?? null,
        ctx.mediaUrls.resolve(assets[index]?.storageKey ?? ""),
        env.PUBLIC_IMAGE_URL,
        (key) => ctx.mediaUrls.resolve(key),
      ),
      bodyUrls: bodyUrls.get(usage.mediaId) ?? [],
    })),
    relations: {
      locations: locations
        .filter((r) => r.articleId === id)
        .map((r) => ({ locationId: r.locationId, relation: r.relation })),
      places: places
        .filter((r) => r.articleId === id)
        .map((r) => ({ placeId: r.placeId, relation: r.relation })),
      categoryIds: categories.filter((r) => r.articleId === id).map((r) => r.categoryId),
      tagIds: tags.filter((r) => r.articleId === id).map((r) => r.tagId),
    },
    collectionIds: resolveJourneyMemberships(
      memberships.filter((m) => m.articleId === id),
      id,
      revision?.journeyIds,
      new Set(collections.filter((c) => c.kind === "journey").map((c) => c.id)),
    ).map((m) => m.collectionId),
    relatedArticleIds: noteRelated
      .filter((relation) => relation.noteId === id)
      .toSorted((a, b) => a.sortOrder - b.sortOrder)
      .map((relation) => relation.articleId),
  };
}

export async function publishCheck(ctx: AppContext, id: ArticleId): Promise<PublishCheckDto> {
  const problems = await checkPublishable(ctx, id);
  return {
    publishable: problems.length === 0,
    problems: problems.map((problem) => ({
      code: problem.code,
      field: problem.field ?? null,
      message: problem.message,
    })),
  };
}
