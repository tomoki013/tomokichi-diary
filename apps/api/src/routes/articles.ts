import { Hono } from "hono";
import { validate } from "@tomokichi/contracts";
import type { ArticleDetailDto, PublishCheckDto } from "@tomokichi/contracts";
import {
  archiveArticle,
  auditArticleBodies,
  checkPublishable,
  linkBodyImages,
  createArticle,
  listArticlesForAdmin,
  publishArticle,
  scheduleArticle,
  setArticleExperienceTags,
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
import type { AppContext } from "@tomokichi/application";
import type { AppEnv } from "../app.js";
import type { Env } from "../env.js";
import { domainErrorResponse, errorResponse } from "../http.js";
import { toArticleMediaDto, toArticleSummaryDto, toRevisionDto } from "../mappers.js";
import {
  createArticleSchema,
  draftSchema,
  experienceTagsSchema,
  relationsSchema,
  publishSchema,
  scheduleSchema,
} from "../schemas.js";

/**
 * The site has one author, whose id is whatever the data says it is (the
 * imported one is a UUID). Multi-author support is a data change, not an API
 * one; until then, a new article belongs to the author on record.
 */
async function siteAuthor(ctx: AppContext): Promise<AuthorId | null> {
  const [author] = await ctx.repos.authors.listAll();
  return author?.id ?? null;
}

export function articleRoutes(publishSite: (env: Env, deferBuild?: boolean) => Promise<unknown>) {
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

    const authorId = await siteAuthor(c.get("ctx"));
    if (!authorId) return errorResponse(c, "API_INTERNAL", "no author is on record", 500);
    const result = await createArticle(c.get("ctx"), {
      slug: parsed.value.slug,
      locale: parsed.value.locale,
      kind: parsed.value.kind,
      authorId,
      path: parsed.value.path,
      draft: parsed.value.draft,
      imageBase: c.env.PUBLIC_IMAGE_URL,
    });
    if (!result.ok) return domainErrorResponse(c, result.errors);
    return c.json({ id: result.value.article.id }, 201);
  });

  // Registered before "/:id" so the path is not read as an article id.
  routes.get("/body-audit", async (c) => {
    const ctx = c.get("ctx");
    const table = new RouteTable(await ctx.repos.routes.listAll());
    const findings = await auditArticleBodies(ctx);
    return c.json({
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
      })),
      total: findings.length,
    });
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
    const body = revision?.bodyMarkdown ?? "";
    const bodyUrls = new Map(
      linkBodyImages(
        body,
        assets.filter((asset) => asset !== null),
        body.includes("/v1/images/") ? await ctx.repos.media.listSlugAliases() : [],
        { resolve: (key) => ctx.mediaUrls.resolve(key) },
      ).images.map((image) => [image.asset.id as string, image.urls]),
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
      experienceTags: article.experienceTags,
      media: usages.map((usage, index) => ({
        ...toArticleMediaDto(
          usage,
          assets[index] ?? null,
          ctx.mediaUrls.resolve(assets[index]?.storageKey ?? ""),
          c.env.PUBLIC_IMAGE_URL,
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
      collectionIds: memberships.filter((m) => m.articleId === id).map((m) => m.collectionId),
    };
    return c.json(detail);
  });

  routes.put("/:id/draft", async (c) => {
    const parsed = validate(draftSchema, await c.req.json().catch(() => null));
    if (!parsed.ok)
      return errorResponse(c, parsed.code, "invalid request body", 400, parsed.issues);

    const ctx = c.get("ctx");
    const articleId = c.req.param("id") as ArticleId;
    // A revision is written by the article's own author, which is always a
    // row that exists.
    const article = await ctx.repos.articles.findById(articleId);
    if (!article) return errorResponse(c, "ARTICLE_NOT_FOUND", `no article ${articleId}`, 404);
    const result = await updateArticleDraft(
      ctx,
      articleId,
      parsed.value,
      article.authorId,
      c.env.PUBLIC_IMAGE_URL,
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
    // Existing clients publish without a body. Bulk clients defer the build,
    // but use the very same per-article validation and published snapshot.
    const input = (await c.req.text()).trim();
    let body: unknown = {};
    if (input !== "") {
      try {
        body = JSON.parse(input);
      } catch {
        body = null;
      }
    }
    const parsed = validate(publishSchema, body);
    if (!parsed.ok)
      return errorResponse(c, parsed.code, "invalid request body", 400, parsed.issues);
    const result = await publishArticle(c.get("ctx"), c.req.param("id") as ArticleId);
    return result.ok
      ? c.json({
          status: result.value.status,
          publication: await publishSite(c.env, parsed.value.deferBuild),
        })
      : domainErrorResponse(c, result.errors);
  });

  routes.post("/:id/unpublish", async (c) => {
    const result = await unpublishArticle(c.get("ctx"), c.req.param("id") as ArticleId);
    return result.ok
      ? c.json({ status: result.value.status, publication: await publishSite(c.env) })
      : domainErrorResponse(c, result.errors);
  });

  routes.post("/:id/archive", async (c) => {
    const result = await archiveArticle(c.get("ctx"), c.req.param("id") as ArticleId);
    return result.ok
      ? c.json({ status: result.value.status, publication: await publishSite(c.env) })
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
    // Checked before anything is written, so a bad id never half-saves.
    const collections = new Set((await ctx.repos.collections.listAll()).map((item) => item.id));
    const unknown = parsed.value.collectionIds.find(
      (collectionId) => !collections.has(collectionId as CollectionId),
    );
    if (unknown)
      return errorResponse(c, "COLLECTION_NOT_FOUND", `no collection ${unknown}`, 404, [
        { path: "collectionIds", message: `no collection ${unknown}` },
      ]);

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
    // sort_order is the article's place inside each collection. Keep what is
    // already stored; a new membership starts at 0 and the site orders ties
    // by trip and publication date. (It used to be the index of the
    // collection in this request, which is unrelated to the collection.)
    const previous = new Map(
      (await ctx.repos.collections.listMemberships())
        .filter((m) => m.articleId === articleId)
        .map((m) => [m.collectionId, m.sortOrder]),
    );
    await ctx.repos.collections.replaceForArticle(
      articleId,
      [...new Set(parsed.value.collectionIds)].map((collectionId) => ({
        articleId,
        collectionId: collectionId as CollectionId,
        sortOrder: previous.get(collectionId as CollectionId) ?? 0,
      })),
    );
    return c.json({ ok: true });
  });

  routes.put("/:id/experience-tags", async (c) => {
    const parsed = validate(experienceTagsSchema, await c.req.json().catch(() => null));
    if (!parsed.ok)
      return errorResponse(c, parsed.code, "invalid request body", 400, parsed.issues);
    const result = await setArticleExperienceTags(
      c.get("ctx"),
      c.req.param("id") as ArticleId,
      parsed.value.experienceTags,
    );
    if (!result.ok) return domainErrorResponse(c, result.errors);
    return c.json({ experienceTags: result.value.experienceTags });
  });

  return routes;
}
