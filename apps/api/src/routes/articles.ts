import { Hono } from "hono";
import { validate } from "@tomokichi/contracts";
import type { ArticleDetailDto, PublishCheckDto } from "@tomokichi/contracts";
import {
  archiveArticle,
  checkPublishable,
  createArticle,
  listArticlesForAdmin,
  publishArticle,
  scheduleArticle,
  unpublishArticle,
  updateArticleDraft,
} from "@tomokichi/application";
import {
  hasUnpublishedChanges,
  isPubliclyVisible,
  parseInstant,
  RouteTable,
  type ArticleId,
  type AuthorId,
  type CategoryId,
  type CollectionId,
  type LocationId,
  type PlaceId,
  type TagId,
} from "@tomokichi/domain";
import type { AppEnv } from "../app.js";
import { domainErrorResponse, errorResponse } from "../http.js";
import { toArticleMediaDto, toArticleSummaryDto, toRevisionDto } from "../mappers.js";
import { createArticleSchema, draftSchema, relationsSchema, scheduleSchema } from "../schemas.js";

/** The only author the site has today; multi-author support is a data change, not an API one. */
const DEFAULT_AUTHOR = "author-tomokichi" as AuthorId;

export function articleRoutes() {
  const routes = new Hono<AppEnv>();

  routes.get("/", async (c) => {
    const ctx = c.get("ctx");
    const summaries = await listArticlesForAdmin(ctx);
    const table = new RouteTable(await ctx.repos.routes.listAll());
    return c.json({
      items: summaries.map((summary) =>
        toArticleSummaryDto({
          article: summary.article,
          title: summary.title,
          path:
            table.canonicalFor(
              summary.article.kind === "page" ? "static" : "article",
              summary.article.id,
            )?.path ?? null,
          hasUnpublishedChanges: summary.hasUnpublishedChanges,
          isLive: summary.isLive,
        }),
      ),
      total: summaries.length,
      offset: 0,
      limit: summaries.length,
      hasMore: false,
    });
  });

  routes.post("/", async (c) => {
    const parsed = validate(createArticleSchema, await c.req.json().catch(() => null));
    if (!parsed.ok)
      return errorResponse(c, parsed.code, "invalid request body", 400, parsed.issues);

    const result = await createArticle(c.get("ctx"), {
      slug: parsed.value.slug,
      locale: parsed.value.locale,
      kind: parsed.value.kind,
      authorId: DEFAULT_AUTHOR,
      path: parsed.value.path,
      draft: parsed.value.draft,
    });
    if (!result.ok) return domainErrorResponse(c, result.errors);
    return c.json({ id: result.value.article.id }, 201);
  });

  routes.get("/:id", async (c) => {
    const ctx = c.get("ctx");
    const id = c.req.param("id") as ArticleId;
    const article = await ctx.repos.articles.findById(id);
    if (!article) return errorResponse(c, "ARTICLE_NOT_FOUND", `no article ${id}`, 404);

    const revision = article.currentRevisionId
      ? await ctx.repos.revisions.findById(article.currentRevisionId)
      : null;
    const table = new RouteTable(await ctx.repos.routes.listAll());
    const usages = await ctx.repos.media.listForArticle(id);
    const assets = await Promise.all(
      usages.map((usage) => ctx.repos.media.findById(usage.mediaId)),
    );

    const [locations, places, categories, tags, memberships] = await Promise.all([
      ctx.repos.relations.listArticleLocations(),
      ctx.repos.relations.listArticlePlaces(),
      ctx.repos.relations.listArticleCategories(),
      ctx.repos.relations.listArticleTags(),
      ctx.repos.collections.listMemberships(),
    ]);

    const detail: ArticleDetailDto = {
      ...toArticleSummaryDto({
        article,
        title: revision?.title ?? "",
        path:
          table.canonicalFor(article.kind === "page" ? "static" : "article", article.id)?.path ??
          null,
        hasUnpublishedChanges: hasUnpublishedChanges(article),
        isLive: isPubliclyVisible(article, ctx.clock.now()),
      }),
      currentRevision: revision ? toRevisionDto(revision) : null,
      publishedRevisionId: article.publishedRevisionId,
      travelStartDate: article.travelStartDate,
      travelEndDate: article.travelEndDate,
      media: usages.map((usage, index) =>
        toArticleMediaDto(
          usage,
          assets[index] ?? null,
          ctx.mediaUrls.resolve(assets[index]?.storageKey ?? ""),
        ),
      ),
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
      collectionIds: memberships.filter((m) => m.articleId === id).map((m) => m.collectionId),
    };
    return c.json(detail);
  });

  routes.put("/:id/draft", async (c) => {
    const parsed = validate(draftSchema, await c.req.json().catch(() => null));
    if (!parsed.ok)
      return errorResponse(c, parsed.code, "invalid request body", 400, parsed.issues);

    const result = await updateArticleDraft(
      c.get("ctx"),
      c.req.param("id") as ArticleId,
      parsed.value,
      DEFAULT_AUTHOR,
    );
    if (!result.ok) return domainErrorResponse(c, result.errors);
    return c.json({ revision: toRevisionDto(result.value.revision) });
  });

  routes.get("/:id/publish-check", async (c) => {
    const problems = await checkPublishable(c.get("ctx"), c.req.param("id") as ArticleId);
    const body: PublishCheckDto = {
      publishable: problems.length === 0,
      problems: problems.map((problem) => ({
        code: problem.code,
        field: problem.field ?? null,
        message: problem.message,
      })),
    };
    return c.json(body);
  });

  routes.post("/:id/publish", async (c) => {
    const result = await publishArticle(c.get("ctx"), c.req.param("id") as ArticleId);
    return result.ok
      ? c.json({ status: result.value.status })
      : domainErrorResponse(c, result.errors);
  });

  routes.post("/:id/unpublish", async (c) => {
    const result = await unpublishArticle(c.get("ctx"), c.req.param("id") as ArticleId);
    return result.ok
      ? c.json({ status: result.value.status })
      : domainErrorResponse(c, result.errors);
  });

  routes.post("/:id/archive", async (c) => {
    const result = await archiveArticle(c.get("ctx"), c.req.param("id") as ArticleId);
    return result.ok
      ? c.json({ status: result.value.status })
      : domainErrorResponse(c, result.errors);
  });

  routes.post("/:id/schedule", async (c) => {
    const parsed = validate(scheduleSchema, await c.req.json().catch(() => null));
    if (!parsed.ok)
      return errorResponse(c, parsed.code, "invalid request body", 400, parsed.issues);

    const at = parseInstant(parsed.value.at);
    if (!at.ok) return domainErrorResponse(c, at.errors);

    const result = await scheduleArticle(c.get("ctx"), c.req.param("id") as ArticleId, at.value);
    return result.ok
      ? c.json({ status: result.value.status })
      : domainErrorResponse(c, result.errors);
  });

  routes.put("/:id/relations", async (c) => {
    const parsed = validate(relationsSchema, await c.req.json().catch(() => null));
    if (!parsed.ok)
      return errorResponse(c, parsed.code, "invalid request body", 400, parsed.issues);

    const ctx = c.get("ctx");
    const articleId = c.req.param("id") as ArticleId;
    if (!(await ctx.repos.articles.findById(articleId))) {
      return errorResponse(c, "ARTICLE_NOT_FOUND", `no article ${articleId}`, 404);
    }

    await ctx.repos.relations.replaceForArticle(articleId, {
      locations: parsed.value.locations.map((r) => ({
        articleId,
        locationId: r.locationId as LocationId,
        relation: r.relation,
      })),
      places: parsed.value.places.map((r) => ({
        articleId,
        placeId: r.placeId as PlaceId,
        relation: r.relation,
      })),
      categories: parsed.value.categoryIds.map((categoryId) => ({
        articleId,
        categoryId: categoryId as CategoryId,
      })),
      tags: parsed.value.tagIds.map((tagId) => ({ articleId, tagId: tagId as TagId })),
    });
    await ctx.repos.collections.replaceForArticle(
      articleId,
      parsed.value.collectionIds.map((collectionId, index) => ({
        articleId,
        collectionId: collectionId as CollectionId,
        sortOrder: index,
      })),
    );
    return c.json({ ok: true });
  });

  return routes;
}
