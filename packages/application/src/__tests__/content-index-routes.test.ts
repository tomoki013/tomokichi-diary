import { describe, expect, it } from "vitest";
import { EMPTY_SNAPSHOT, type ContentSnapshot } from "@tomokichi/data";
import type { Article, ArticleRevision, Instant, Route } from "@tomokichi/domain";
import { ContentIndex } from "../read/content-index.js";

const NOW = "2026-10-17T10:00:00.000Z" as Instant;
const route = (targetType: Route["targetType"], targetId: string, path: string): Route =>
  ({ targetType, targetId, path, isCanonical: true }) as Route;

function fixture(): ContentSnapshot {
  const articles = [
    { id: "published", status: "published", publishedRevisionId: "r-published" },
    // Published content with a newer draft must keep its current public URL.
    {
      id: "edited",
      status: "published",
      publishedRevisionId: "r-edited",
      currentRevisionId: "draft-edit",
    },
    { id: "draft", status: "draft", publishedRevisionId: null },
    { id: "archived", status: "archived", publishedRevisionId: "r-archived" },
    {
      id: "future",
      status: "published",
      publishedRevisionId: "r-future",
      publishedAt: "2026-10-18T00:00:00.000Z",
    },
    { id: "missing-revision", status: "published", publishedRevisionId: "missing" },
    { id: "draft-page", kind: "page", status: "draft", publishedRevisionId: null },
  ].map((a) => ({ kind: "article", publishedAt: null, ...a })) as Article[];
  return {
    ...EMPTY_SNAPSHOT,
    articles,
    revisions: articles
      .filter((a) => a.publishedRevisionId?.startsWith("r-"))
      .map((a) => ({ id: a.publishedRevisionId, articleId: a.id })) as ArticleRevision[],
    routes: [
      ...articles.map((a) => route(a.kind === "page" ? "static" : "article", a.id, `/${a.id}`)),
      route("article", "unknown", "/unknown"),
      route("static", "home", "/"),
      route("static", "archive", "/archive"),
      route("location", "paris", "/locations/paris"),
      route("series", "music", "/series/music"),
      { ...route("redirect", "", "/old"), redirectTo: "/published" },
    ],
  };
}

describe("ContentIndex public routes", () => {
  it("emits published content and built-in pages, excluding draft, future, archived and missing targets", () => {
    const index = new ContentIndex(fixture(), NOW);
    expect(index.publicRoutes().map((r) => r.path)).toEqual([
      "/published",
      "/edited",
      "/",
      "/archive",
      "/locations/paris",
      "/series/music",
    ]);
  });

  it("preserves draft routes for editing and canonical preview resolution", () => {
    const index = new ContentIndex(fixture(), NOW);
    expect(index.routes.canonicalFor("article", "draft")?.path).toBe("/draft");
    expect(index.routes.canonicalFor("static", "draft-page")?.path).toBe("/draft-page");
    expect(index.viewOf("draft" as Article["id"])).toBeNull();
  });
});
