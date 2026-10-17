import { describe, expect, it } from "vitest";
import { EMPTY_SNAPSHOT, type ContentSnapshot } from "@tomokichi/data";
import type { Article, ArticleRevision, CollectionId, Route } from "@tomokichi/domain";
import { ContentIndex } from "../read/content-index.js";

const NOW = "2026-09-01T00:00:00.000Z" as Article["updatedAt"];

function article(
  slug: string,
  options: { trip?: string; published?: string; status?: Article["status"] } = {},
): Article {
  const live = (options.status ?? "published") === "published";
  return {
    id: slug,
    kind: "article",
    status: options.status ?? "published",
    locale: "ja",
    slug,
    authorId: "author",
    currentRevisionId: `r-${slug}`,
    publishedRevisionId: live ? `r-${slug}` : null,
    createdAt: NOW,
    updatedAt: NOW,
    scheduledAt: null,
    publishedAt: live ? (options.published ?? "2026-08-01T00:00:00.000Z") : null,
    archivedAt: null,
    noindex: false,
    travelStartDate: options.trip ?? null,
    travelEndDate: null,
    experienceTags: [],
  } as unknown as Article;
}

function index(articles: Article[], members: [string, string, number][]) {
  const snapshot: ContentSnapshot = {
    ...EMPTY_SNAPSHOT,
    articles,
    revisions: articles.map(
      (a) =>
        ({
          id: `r-${a.slug}`,
          articleId: a.id,
          title: a.slug,
          summary: "",
        }) as unknown as ArticleRevision,
    ),
    routes: articles.map(
      (a) =>
        ({
          id: `route-${a.id}`,
          path: `/posts/${a.slug}`,
          targetType: "article",
          targetId: a.id,
          isCanonical: true,
        }) as unknown as Route,
    ),
    articleCollections: members.map(([collectionId, articleId, sortOrder]) => ({
      collectionId: collectionId as CollectionId,
      articleId,
      sortOrder,
    })) as unknown as ContentSnapshot["articleCollections"],
  };
  return new ContentIndex(snapshot, NOW);
}

describe("ContentIndex collections", () => {
  it("orders by sort_order, then trip date, publication date and slug, whatever the input order", () => {
    const articles = [
      article("zeta", { trip: "2024-09-20" }),
      article("alpha", { trip: "2024-09-29" }),
      article("beta", { trip: "2024-09-25", published: "2024-10-02T00:00:00.000Z" }),
      article("gamma", { trip: "2024-09-25", published: "2024-10-01T00:00:00.000Z" }),
      article("no-trip"),
      article("pinned", { trip: "2030-01-01" }),
    ];
    const rows: [string, string, number][] = [
      ["c", "alpha", 0],
      ["c", "no-trip", 0],
      ["c", "beta", 0],
      ["c", "zeta", 0],
      ["c", "gamma", 0],
      ["c", "pinned", -1],
    ];
    const expected = ["pinned", "zeta", "gamma", "beta", "alpha", "no-trip"];
    expect(
      index(articles, rows)
        .membersOf("c" as CollectionId)
        .map((v) => v.article.slug),
    ).toEqual(expected);
    expect(
      index(articles, rows.toReversed())
        .membersOf("c" as CollectionId)
        .map((v) => v.article.slug),
    ).toEqual(expected);
  });

  it("never lists drafts and treats a collection of drafts as empty", () => {
    const content = index(
      [article("draft", { status: "draft" }), article("live")],
      [
        ["mixed", "draft", 0],
        ["mixed", "live", 0],
        ["empty", "draft", 0],
      ],
    );
    expect(content.membersOf("mixed" as CollectionId).map((v) => v.article.slug)).toEqual(["live"]);
    expect(content.hasPublicMembers("mixed" as CollectionId)).toBe(true);
    expect(content.hasPublicMembers("empty" as CollectionId)).toBe(false);
  });
});

describe("ContentIndex page routes", () => {
  it("leaves a draft's reserved URL out of the build and keeps static pages", () => {
    const draft = article("draft-song", { status: "draft" });
    const live = article("live-song");
    const base = index([draft, live], []);
    const content = new ContentIndex(
      {
        ...base.snapshot,
        routes: [
          ...base.snapshot.routes,
          {
            id: "route-home",
            path: "/",
            targetType: "static",
            targetId: "home",
            isCanonical: true,
          } as unknown as Route,
        ],
      },
      NOW,
    );
    expect(
      content
        .pageRoutes()
        .map((route) => route.path)
        .toSorted(),
    ).toEqual(["/", "/posts/live-song"]);
  });
});
