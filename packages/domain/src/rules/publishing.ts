import type { Article, ArticleRevision } from "../entities/article.js";
import type { ArticleMedia } from "../entities/media.js";
import type { Route } from "../entities/route.js";
import { isAfterOrEqual, type Instant } from "../primitives/datetime.js";
import { err, ok, type DomainError, type Result } from "../primitives/result.js";

export interface PublishInput {
  readonly article: Article;
  readonly revision: ArticleRevision;
  readonly canonicalRoute: Route | undefined;
  readonly media: readonly ArticleMedia[];
  readonly now: Instant;
}

const MIN_BODY_LENGTH = 200;
const MAX_TITLE_LENGTH = 120;

/**
 * Everything that must hold before an article can go live. Kept as one pure
 * function so the API, the admin UI and CI all agree on what "publishable" means.
 */
export function validatePublishable(input: PublishInput): readonly DomainError[] {
  const { article, revision, canonicalRoute, media } = input;
  const errors: DomainError[] = [];

  const fail = (message: string, field: string): void => {
    errors.push({ code: "ARTICLE_NOT_PUBLISHABLE", message, field });
  };

  if (article.status === "archived") fail("archived articles cannot be published", "status");
  if (revision.articleId !== article.id)
    fail("revision belongs to a different article", "revisionId");
  if (revision.title.trim() === "") fail("title is required", "title");
  if (revision.title.length > MAX_TITLE_LENGTH)
    fail(`title must be at most ${MAX_TITLE_LENGTH} characters`, "title");
  if (revision.summary.trim() === "") fail("summary is required", "summary");
  if (revision.bodyMarkdown.trim().length < MIN_BODY_LENGTH) {
    fail(`body must be at least ${MIN_BODY_LENGTH} characters`, "bodyMarkdown");
  }

  if (!canonicalRoute) fail("a canonical route is required", "route");
  else if (canonicalRoute.targetType !== "article" || canonicalRoute.targetId !== article.id) {
    fail("canonical route points at a different target", "route");
  }

  const cover = media.filter((m) => m.role === "cover");
  if (cover.length === 0) fail("a cover image is required", "media");
  if (cover.some((m) => m.alt.trim() === "")) fail("cover image requires alt text", "media");

  if (
    article.status === "scheduled" &&
    article.scheduledAt &&
    !isAfterOrEqual(input.now, article.scheduledAt)
  ) {
    fail("scheduled publication time has not been reached", "scheduledAt");
  }

  return errors;
}

/** Publishing is a pointer swap: the revision itself is never mutated. */
export function publish(input: PublishInput): Result<Article> {
  const errors = validatePublishable(input);
  if (errors.length > 0) return err<Article>(...errors);

  return ok({
    ...input.article,
    status: "published",
    publishedRevisionId: input.revision.id,
    currentRevisionId: input.revision.id,
    publishedAt: input.article.publishedAt ?? input.now,
    scheduledAt: null,
    updatedAt: input.now,
    archivedAt: null,
  });
}

export function unpublish(article: Article, now: Instant): Article {
  return { ...article, status: "draft", publishedRevisionId: null, updatedAt: now };
}

export function archive(article: Article, now: Instant): Article {
  return {
    ...article,
    status: "archived",
    publishedRevisionId: null,
    archivedAt: now,
    updatedAt: now,
  };
}

export function schedule(article: Article, at: Instant, now: Instant): Result<Article> {
  if (!isAfterOrEqual(at, now)) {
    return err({
      code: "ARTICLE_NOT_PUBLISHABLE",
      message: "scheduled time must be in the future",
      field: "scheduledAt",
    });
  }
  return ok({ ...article, status: "scheduled", scheduledAt: at, updatedAt: now });
}

/** What the public site renders — a draft edit on a live article changes nothing here. */
export function publicRevisionId(article: Article): string | null {
  return article.status === "published" ? article.publishedRevisionId : null;
}

export function isPubliclyVisible(article: Article, now: Instant): boolean {
  if (article.status !== "published") return false;
  if (article.publishedRevisionId === null) return false;
  if (article.publishedAt && !isAfterOrEqual(now, article.publishedAt)) return false;
  return true;
}

/** Public listings and the sitemap exclude noindex articles; direct URLs still resolve. */
export function isIndexable(article: Article, now: Instant): boolean {
  return isPubliclyVisible(article, now) && !article.noindex;
}
