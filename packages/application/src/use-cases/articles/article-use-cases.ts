import {
  archive,
  err,
  hasUnpublishedChanges,
  isPubliclyVisible,
  nextRevision,
  ok,
  parseRoutePath,
  parseSlug,
  publish,
  schedule,
  unpublish,
  validatePublishable,
  type Article,
  type ArticleId,
  type ArticleRevision,
  type AuthorId,
  type DraftInput,
  type Instant,
  type Locale,
  type Result,
  type RevisionId,
  type Route,
  type RouteId,
} from "@tomokichi/domain";
import type { AppContext } from "../../context.js";

export interface CreateArticleInput {
  readonly slug: string;
  readonly kind?: "article" | "page";
  readonly locale: Locale;
  readonly authorId: AuthorId;
  readonly draft: DraftInput;
  /** Canonical URL for the article. Supplied explicitly — never derived from the slug. */
  readonly path: string;
}

export interface ArticleWithRevision {
  readonly article: Article;
  readonly revision: ArticleRevision;
}

export async function createArticle(
  ctx: AppContext,
  input: CreateArticleInput,
): Promise<Result<ArticleWithRevision>> {
  const slug = parseSlug(input.slug);
  if (!slug.ok) return err(...slug.errors);
  const path = parseRoutePath(input.path);
  if (!path.ok) return err(...path.errors);

  if (await ctx.repos.articles.findBySlug(slug.value, input.locale)) {
    return err({
      code: "API_CONFLICT",
      message: `slug already in use: ${slug.value}`,
      field: "slug",
    });
  }
  if (await ctx.repos.routes.findByPath(path.value)) {
    return err({
      code: "API_CONFLICT",
      message: `path already in use: ${path.value}`,
      field: "path",
    });
  }

  const now = ctx.clock.now();
  const id = ctx.ids.next<ArticleId>();
  const article: Article = {
    id,
    kind: input.kind ?? "article",
    status: "draft",
    locale: input.locale,
    slug: slug.value,
    authorId: input.authorId,
    currentRevisionId: null,
    publishedRevisionId: null,
    createdAt: now,
    updatedAt: now,
    scheduledAt: null,
    publishedAt: null,
    archivedAt: null,
    noindex: false,
    travelStartDate: null,
    travelEndDate: null,
  };
  const revision = nextRevision({
    article,
    previous: null,
    id: ctx.ids.next<RevisionId>(),
    input: input.draft,
    createdBy: input.authorId,
    now,
  });
  const route: Route = {
    id: ctx.ids.next<RouteId>(),
    path: path.value,
    locale: input.locale,
    targetType: "article",
    targetId: id,
    isCanonical: true,
    redirectTo: null,
    redirectStatus: null,
    isLegacy: false,
    noindex: false,
  };

  // The article row exists first so the revision's foreign key resolves, then
  // the article is updated to point at the revision it now owns.
  await ctx.repos.articles.save(article);
  await ctx.repos.revisions.save(revision);
  await ctx.repos.articles.save({ ...article, currentRevisionId: revision.id });
  await ctx.repos.routes.save(route);
  ctx.logger.info("article.created", { articleId: id, route: route.path });

  return ok({ article: { ...article, currentRevisionId: revision.id }, revision });
}

/** Saving a draft never touches what the public site serves (instruction §16). */
export async function updateArticleDraft(
  ctx: AppContext,
  articleId: ArticleId,
  draft: DraftInput,
  editedBy: AuthorId,
): Promise<Result<ArticleWithRevision>> {
  const article = await ctx.repos.articles.findById(articleId);
  if (!article) return err({ code: "ARTICLE_NOT_FOUND", message: `no article ${articleId}` });

  const previous = await ctx.repos.revisions.findLatest(articleId);
  const now = ctx.clock.now();
  const revision = nextRevision({
    article,
    previous,
    id: ctx.ids.next<RevisionId>(),
    input: draft,
    createdBy: editedBy,
    now,
  });
  const updated: Article = { ...article, currentRevisionId: revision.id, updatedAt: now };

  await ctx.repos.revisions.save(revision);
  await ctx.repos.articles.save(updated);
  return ok({ article: updated, revision });
}

async function publishInputFor(ctx: AppContext, articleId: ArticleId) {
  const article = await ctx.repos.articles.findById(articleId);
  if (!article) return null;
  const revisionId = article.currentRevisionId;
  const revision = revisionId ? await ctx.repos.revisions.findById(revisionId) : null;
  if (!revision) return null;
  const routes = await ctx.repos.routes.listAll();
  const canonicalRoute = routes.find(
    (r) => r.isCanonical && r.targetType === "article" && r.targetId === articleId,
  );
  const media = await ctx.repos.media.listForArticle(articleId);
  return { article, revision, canonicalRoute, media, now: ctx.clock.now() };
}

export async function publishArticle(
  ctx: AppContext,
  articleId: ArticleId,
): Promise<Result<Article>> {
  const input = await publishInputFor(ctx, articleId);
  if (!input)
    return err({ code: "ARTICLE_NOT_FOUND", message: `no publishable article ${articleId}` });

  const result = publish(input);
  if (!result.ok) {
    ctx.logger.warn("article.publish_rejected", { articleId, code: "ARTICLE_NOT_PUBLISHABLE" });
    return result;
  }
  await ctx.repos.articles.save(result.value);
  ctx.logger.info("article.published", { articleId });
  return result;
}

/** Dry run used by the admin to show why publishing is blocked. */
export async function checkPublishable(ctx: AppContext, articleId: ArticleId) {
  const input = await publishInputFor(ctx, articleId);
  if (!input)
    return [{ code: "ARTICLE_NOT_FOUND" as const, message: `no publishable article ${articleId}` }];
  return validatePublishable(input);
}

export async function unpublishArticle(
  ctx: AppContext,
  articleId: ArticleId,
): Promise<Result<Article>> {
  const article = await ctx.repos.articles.findById(articleId);
  if (!article) return err({ code: "ARTICLE_NOT_FOUND", message: `no article ${articleId}` });
  const updated = unpublish(article, ctx.clock.now());
  await ctx.repos.articles.save(updated);
  return ok(updated);
}

export async function archiveArticle(
  ctx: AppContext,
  articleId: ArticleId,
): Promise<Result<Article>> {
  const article = await ctx.repos.articles.findById(articleId);
  if (!article) return err({ code: "ARTICLE_NOT_FOUND", message: `no article ${articleId}` });
  const updated = archive(article, ctx.clock.now());
  await ctx.repos.articles.save(updated);
  return ok(updated);
}

export async function scheduleArticle(
  ctx: AppContext,
  articleId: ArticleId,
  at: Instant,
): Promise<Result<Article>> {
  const article = await ctx.repos.articles.findById(articleId);
  if (!article) return err({ code: "ARTICLE_NOT_FOUND", message: `no article ${articleId}` });
  const result = schedule(article, at, ctx.clock.now());
  if (result.ok) await ctx.repos.articles.save(result.value);
  return result;
}

export interface ArticleAdminSummary {
  readonly article: Article;
  readonly title: string;
  readonly hasUnpublishedChanges: boolean;
  readonly isLive: boolean;
}

export async function listArticlesForAdmin(
  ctx: AppContext,
): Promise<readonly ArticleAdminSummary[]> {
  const articles = await ctx.repos.articles.listAll();
  const now = ctx.clock.now();
  return Promise.all(
    articles.map(async (article) => {
      const revisionId = article.currentRevisionId;
      const revision = revisionId ? await ctx.repos.revisions.findById(revisionId) : null;
      return {
        article,
        title: revision?.title ?? "(untitled)",
        hasUnpublishedChanges: hasUnpublishedChanges(article),
        isLive: isPubliclyVisible(article, now),
      };
    }),
  );
}
