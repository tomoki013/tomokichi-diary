import {
  validateArticleMonetization,
  projectArticleMonetization,
} from "../monetization/manage-monetization.js";
import {
  archive,
  disallowedHtml,
  err,
  ineffectiveBold,
  hasUnpublishedChanges,
  inlineInternalLinks,
  isPubliclyVisible,
  nextRevision,
  ok,
  parseRoutePath,
  parseExperienceTags,
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
import { linkBodyImages, withBodyUsages, type BodyImage } from "../content/media-links.js";

export interface CreateArticleInput {
  readonly slug: string;
  readonly kind?: "article" | "page";
  readonly locale: Locale;
  readonly authorId: AuthorId;
  readonly draft: DraftInput;
  /** Canonical URL for the article. Supplied explicitly — never derived from the slug. */
  readonly path: string;
  /** Base of the public slug aliases body photos are pointed at (`…/v1/images`). */
  readonly imageBase?: string | undefined;
}

export interface ArticleWithRevision {
  readonly article: Article;
  readonly revision: ArticleRevision;
}

/**
 * The body decides which photos an article shows: a library photo written into
 * it, by whatever URL, is pointed at its slug alias and listed on the article.
 */
async function linkDraftImages(
  ctx: AppContext,
  draft: DraftInput,
  imageBase: string | undefined,
): Promise<{ draft: DraftInput; images: readonly BodyImage[] }> {
  if (!draft.bodyMarkdown.includes("![")) return { draft, images: [] };
  const [media, aliases] = await Promise.all([
    ctx.repos.media.listAll(),
    ctx.repos.media.listSlugAliases(),
  ]);
  const linked = linkBodyImages(draft.bodyMarkdown, media, aliases, {
    resolve: (key) => ctx.mediaUrls.resolve(key),
    ...(imageBase ? { imageBase } : {}),
  });
  return { draft: { ...draft, bodyMarkdown: linked.markdown }, images: linked.images };
}

async function listBodyImages(
  ctx: AppContext,
  articleId: ArticleId,
  images: readonly BodyImage[],
): Promise<void> {
  if (images.length === 0) return;
  const usages = await ctx.repos.media.listForArticle(articleId);
  const next = withBodyUsages(articleId, usages, images);
  if (next !== usages) await ctx.repos.media.replaceForArticle(articleId, next);
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

  const { draft, images } = await linkDraftImages(ctx, input.draft, input.imageBase);
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
    experienceTags: [],
  };
  const revision = nextRevision({
    article,
    previous: null,
    id: ctx.ids.next<RevisionId>(),
    input: draft,
    createdBy: input.authorId,
    now,
  });
  const route: Route = {
    id: ctx.ids.next<RouteId>(),
    path: path.value,
    locale: input.locale,
    targetType: article.kind === "page" ? "static" : "article",
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
  await listBodyImages(ctx, id, images);
  ctx.logger.info("article.created", { articleId: id, route: route.path });

  return ok({ article: { ...article, currentRevisionId: revision.id }, revision });
}

/** Saving a draft never touches what the public site serves (instruction §16). */
export async function updateArticleDraft(
  ctx: AppContext,
  articleId: ArticleId,
  input: DraftInput,
  editedBy: AuthorId,
  imageBase?: string,
): Promise<Result<ArticleWithRevision>> {
  const article = await ctx.repos.articles.findById(articleId);
  if (!article) return err({ code: "ARTICLE_NOT_FOUND", message: `no article ${articleId}` });
  const { draft, images } = await linkDraftImages(ctx, input, imageBase);

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
  // Saving a registered metadata section also saves the draft. Keep structured
  // embeds with the new revision, just as their stable Markdown anchors persist.
  if (article.currentRevisionId) {
    const embeds = await ctx.repos.embeds.listByRevision(article.currentRevisionId);
    if (embeds.length)
      await ctx.repos.embeds.replaceForRevision(
        revision.id,
        embeds.map((embed) => ({ ...embed, id: ctx.ids.next<string>(), revisionId: revision.id })),
      );
  }
  const knowledge = (await ctx.repos.knowledge.listArticleKnowledge()).find(
    (entry) => entry.articleId === articleId && entry.revisionId === article.currentRevisionId,
  );
  if (knowledge)
    await ctx.repos.knowledge.saveArticleKnowledge({ ...knowledge, revisionId: revision.id });
  await ctx.repos.articles.save(updated);
  await listBodyImages(ctx, articleId, images);
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
    (r) =>
      r.isCanonical &&
      r.targetType === (article.kind === "page" ? "static" : "article") &&
      r.targetId === articleId,
  );
  const media = await ctx.repos.media.listForArticle(articleId);
  return { article, revision, canonicalRoute, media, routes, now: ctx.clock.now() };
}

export async function publishArticle(
  ctx: AppContext,
  articleId: ArticleId,
): Promise<Result<Article>> {
  const input = await publishInputFor(ctx, articleId);
  if (!input)
    return err({ code: "ARTICLE_NOT_FOUND", message: `no publishable article ${articleId}` });

  const monetizationErrors = await validateArticleMonetization(ctx, articleId);
  if (monetizationErrors.length) return err(...monetizationErrors);
  const result = publish(input);
  if (!result.ok) {
    ctx.logger.warn("article.publish_rejected", { articleId, code: "ARTICLE_NOT_PUBLISHABLE" });
    return result;
  }
  const [media, locations, places, categories, tags, collections] = await Promise.all([
    ctx.repos.media.listForArticle(articleId),
    ctx.repos.relations.listArticleLocations(),
    ctx.repos.relations.listArticlePlaces(),
    ctx.repos.relations.listArticleCategories(),
    ctx.repos.relations.listArticleTags(),
    ctx.repos.collections.listMemberships(),
  ]);
  await ctx.repos.publicationMetadata.save(input.revision.id, {
    media,
    locations: locations.filter((r) => r.articleId === articleId),
    places: places.filter((r) => r.articleId === articleId),
    categories: categories.filter((r) => r.articleId === articleId),
    tags: tags.filter((r) => r.articleId === articleId),
    collections: collections.filter((r) => r.articleId === articleId),
    experienceTags: input.article.experienceTags,
    ...(input.article.kind === "article"
      ? { monetization: await projectArticleMonetization(ctx, articleId) }
      : {}),
  });
  await ctx.repos.articles.save(result.value);
  ctx.logger.info("article.published", { articleId });
  await ctx.analytics?.track({ name: "article_published", articleId });
  return result;
}

/** Dry run used by the admin to show why publishing is blocked. */
export async function checkPublishable(ctx: AppContext, articleId: ArticleId) {
  const input = await publishInputFor(ctx, articleId);
  if (!input)
    return [{ code: "ARTICLE_NOT_FOUND" as const, message: `no publishable article ${articleId}` }];
  return [
    ...(await validateArticleMonetization(ctx, articleId)),
    ...validatePublishable({
      ...input,
      now:
        input.article.scheduledAt && input.article.scheduledAt > input.now
          ? input.article.scheduledAt
          : input.now,
    }),
  ];
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
  const problems = await checkPublishable(ctx, articleId);
  if (problems.length) return err(...problems);
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

export interface ArticleBodyFinding {
  readonly article: Article;
  readonly title: string;
  readonly disallowedHtml: readonly string[];
  readonly inlineInternalLinks: readonly string[];
  readonly ineffectiveBold: readonly string[];
}

/**
 * Reads every article's current draft and reports only the bodies that need a
 * hand: raw HTML and unrendered bold the publish check rejects, and site links sitting inside a
 * sentence where the page cannot turn them into cards. The bodies themselves
 * never leave the server.
 */
export async function auditArticleBodies(ctx: AppContext): Promise<readonly ArticleBodyFinding[]> {
  const articles = await ctx.repos.articles.listAll();
  const findings = await Promise.all(
    articles.map(async (article): Promise<ArticleBodyFinding | null> => {
      const revisionId = article.currentRevisionId;
      const revision = revisionId ? await ctx.repos.revisions.findById(revisionId) : null;
      if (!revision) return null;
      return {
        article,
        title: revision.title,
        disallowedHtml: disallowedHtml(revision.bodyMarkdown),
        inlineInternalLinks: inlineInternalLinks(revision.bodyMarkdown),
        ineffectiveBold: ineffectiveBold(revision.bodyMarkdown),
      };
    }),
  );
  return findings.filter(
    (finding): finding is ArticleBodyFinding =>
      finding !== null &&
      (finding.disallowedHtml.length > 0 ||
        finding.inlineInternalLinks.length > 0 ||
        finding.ineffectiveBold.length > 0),
  );
}

/**
 * Replaces what an article is marked as feeling like. Metadata about the trip,
 * not an edit of its prose: no revision is created and `updatedAt` — which
 * readers and search engines see as "last updated" — is left alone.
 */
export async function setArticleExperienceTags(
  ctx: AppContext,
  articleId: ArticleId,
  values: readonly unknown[],
): Promise<Result<Article>> {
  const article = await ctx.repos.articles.findById(articleId);
  if (!article) return err({ code: "ARTICLE_NOT_FOUND", message: `no article ${articleId}` });
  const tags = parseExperienceTags(values);
  if (!tags.ok) return err(...tags.errors);

  const updated: Article = { ...article, experienceTags: tags.value };
  await ctx.repos.articles.save(updated);
  ctx.logger.info("article.experience_tags_set", { articleId, tags: tags.value.join(",") });
  return ok(updated);
}
