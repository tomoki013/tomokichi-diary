import type { Article, ArticleRevision } from "../entities/article.js";
import type { ArticleMedia } from "../entities/media.js";
import type { Route } from "../entities/route.js";
import { instantFrom, type Instant } from "../primitives/datetime.js";
import {
  asId,
  type ArticleId,
  type AuthorId,
  type MediaId,
  type RevisionId,
  type RouteId,
} from "../primitives/id.js";
import type { Slug } from "../primitives/slug.js";

export const NOW = instantFrom("2026-08-30T00:00:00.000Z");
export const AUTHOR = asId<AuthorId>("author-tomokichi");

export function articleId(n: number): ArticleId {
  return asId<ArticleId>(`article-${n}`);
}

export function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: articleId(1),
    status: "draft",
    locale: "ja",
    slug: "chagee-menu-explained" as Slug,
    authorId: AUTHOR,
    currentRevisionId: asId<RevisionId>("rev-1"),
    publishedRevisionId: null,
    createdAt: instantFrom("2026-08-01T00:00:00.000Z"),
    updatedAt: instantFrom("2026-08-01T00:00:00.000Z"),
    scheduledAt: null,
    publishedAt: null,
    archivedAt: null,
    noindex: false,
    travelStartDate: null,
    travelEndDate: null,
    ...overrides,
  };
}

export function makeRevision(overrides: Partial<ArticleRevision> = {}): ArticleRevision {
  return {
    id: asId<RevisionId>("rev-1"),
    articleId: articleId(1),
    revisionNumber: 1,
    title: "CHAGEEのメニューを日本語で解説",
    summary: "実際に飲んだ4種類の茶葉・香り・特徴をまとめました。",
    bodyMarkdown: "本文".repeat(200),
    seoTitleOverride: null,
    seoDescriptionOverride: null,
    changeSummary: null,
    createdAt: instantFrom("2026-08-01T00:00:00.000Z"),
    createdBy: AUTHOR,
    ...overrides,
  };
}

export function makeRoute(overrides: Partial<Route> = {}): Route {
  return {
    id: asId<RouteId>("route-1"),
    path: "/posts/chagee-menu-explained" as Route["path"],
    locale: "ja",
    targetType: "article",
    targetId: articleId(1),
    isCanonical: true,
    redirectTo: null,
    redirectStatus: null,
    isLegacy: true,
    ...overrides,
  };
}

export function makeCover(overrides: Partial<ArticleMedia> = {}): ArticleMedia {
  return {
    articleId: articleId(1),
    mediaId: asId<MediaId>("media-1"),
    role: "cover",
    sortOrder: 0,
    alt: "上海のCHAGEE店舗",
    caption: null,
    ...overrides,
  };
}

export function at(iso: string): Instant {
  return instantFrom(iso);
}
