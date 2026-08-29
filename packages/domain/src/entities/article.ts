import type { ArticleId, AuthorId, RevisionId } from "../primitives/id.js";
import type { Instant, PlainDate } from "../primitives/datetime.js";
import type { Locale } from "../primitives/locale.js";
import type { Slug } from "../primitives/slug.js";

export const ARTICLE_STATUSES = ["draft", "scheduled", "published", "archived"] as const;
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];

/**
 * Identity and lifecycle only. Everything an editor types lives in an
 * ArticleRevision, so publishing is a pointer swap rather than a content copy.
 */
export interface Article {
  readonly id: ArticleId;
  readonly status: ArticleStatus;
  readonly locale: Locale;
  /** Editorial identifier; never used to build URLs. */
  readonly slug: Slug;
  readonly authorId: AuthorId;
  /** What the editor is working on. */
  readonly currentRevisionId: RevisionId | null;
  /** What the public site renders. Null until first publish. */
  readonly publishedRevisionId: RevisionId | null;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
  readonly scheduledAt: Instant | null;
  readonly publishedAt: Instant | null;
  readonly archivedAt: Instant | null;
  /** When the trip actually happened, which is rarely when it was published. */
  readonly travelStartDate: PlainDate | null;
  readonly travelEndDate: PlainDate | null;
  /** Excluded from sitemap and marked noindex while true. */
  readonly noindex: boolean;
}

export interface ArticleRevision {
  readonly id: RevisionId;
  readonly articleId: ArticleId;
  readonly revisionNumber: number;
  readonly title: string;
  readonly summary: string;
  /** Canonical source of the article body (ADR 0001). Never HTML, never MDX. */
  readonly bodyMarkdown: string;
  readonly seoTitleOverride: string | null;
  readonly seoDescriptionOverride: string | null;
  readonly changeSummary: string | null;
  readonly createdAt: Instant;
  readonly createdBy: AuthorId;
}

export const EMBED_TYPES = [
  "map",
  "gallery",
  "timeline",
  "table",
  "notice",
  "interactive",
] as const;
export type EmbedType = (typeof EMBED_TYPES)[number];

/**
 * Structured content Markdown cannot express, referenced from the body as
 * `{{embed:anchor-key}}`. The payload describes *what* it is, never which
 * component renders it.
 */
export interface ArticleEmbed {
  readonly id: string;
  readonly revisionId: RevisionId;
  readonly anchorKey: string;
  readonly type: EmbedType;
  readonly schemaVersion: number;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface Author {
  readonly id: AuthorId;
  readonly name: string;
  readonly url: string | null;
  readonly bio: string | null;
}
