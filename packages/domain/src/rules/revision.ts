import type { Article, ArticleRevision } from "../entities/article.js";
import type { AuthorId, RevisionId } from "../primitives/id.js";
import type { Instant } from "../primitives/datetime.js";

export interface DraftInput {
  readonly title: string;
  readonly summary: string;
  readonly bodyMarkdown: string;
  readonly seoTitleOverride?: string | null;
  readonly seoDescriptionOverride?: string | null;
  readonly changeSummary?: string | null;
}

/**
 * Revisions are immutable: editing produces revision n+1 rather than rewriting
 * n. That is what makes "published" a stable snapshot while drafts move on.
 */
export function nextRevision(params: {
  article: Article;
  previous: ArticleRevision | null;
  id: RevisionId;
  input: DraftInput;
  createdBy: AuthorId;
  now: Instant;
}): ArticleRevision {
  const { article, previous, id, input, createdBy, now } = params;
  return {
    id,
    articleId: article.id,
    revisionNumber: (previous?.revisionNumber ?? 0) + 1,
    title: input.title,
    summary: input.summary,
    bodyMarkdown: input.bodyMarkdown,
    seoTitleOverride: input.seoTitleOverride ?? null,
    seoDescriptionOverride: input.seoDescriptionOverride ?? null,
    changeSummary: input.changeSummary ?? null,
    createdAt: now,
    createdBy,
  };
}

/** True when the editor has unpublished work — the admin surfaces this, the site ignores it. */
export function hasUnpublishedChanges(article: Article): boolean {
  return (
    article.currentRevisionId !== null && article.currentRevisionId !== article.publishedRevisionId
  );
}
