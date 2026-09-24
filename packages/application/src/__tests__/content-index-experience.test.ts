import { describe, expect, it } from "vitest";
import { EMPTY_SNAPSHOT, type ContentSnapshot } from "@tomokichi/data";
import type { Article, ArticleRevision, ExperienceTag, Location, Route } from "@tomokichi/domain";
import { ContentIndex } from "../read/content-index.js";

const NOW = "2026-09-01T00:00:00.000Z" as Article["updatedAt"];

function article(n: number, experienceTags: ExperienceTag[]): Article {
  const day = String(n).padStart(2, "0");
  return {
    id: `a${n}`,
    kind: "article",
    status: "published",
    locale: "ja",
    slug: `a${n}`,
    authorId: "author",
    currentRevisionId: `r${n}`,
    publishedRevisionId: `r${n}`,
    createdAt: NOW,
    updatedAt: NOW,
    scheduledAt: null,
    // Higher n is newer.
    publishedAt: `2026-08-${day}T00:00:00.000Z`,
    archivedAt: null,
    noindex: false,
    travelStartDate: null,
    travelEndDate: null,
    experienceTags,
  } as unknown as Article;
}

const location = (id: string, type: Location["type"], parentId: string | null) =>
  ({ id, slug: id, type, parentId }) as unknown as Location;

function snapshot(articles: Article[], placed: Record<string, string[]>): ContentSnapshot {
  return {
    ...EMPTY_SNAPSHOT,
    articles,
    revisions: articles.map(
      (a) =>
        ({
          id: a.publishedRevisionId,
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
    locations: [
      location("asia", "continent", null),
      location("thailand", "country", "asia"),
      location("bangkok", "city", "thailand"),
      location("india", "country", "asia"),
    ],
    // The first location listed is the primary one.
    articleLocations: Object.entries(placed).flatMap(([articleId, locationIds]) =>
      locationIds.map((locationId, index) => ({
        articleId,
        locationId,
        relation: index === 0 ? "primary" : "mentioned",
      })),
    ) as unknown as ContentSnapshot["articleLocations"],
  };
}

describe("ContentIndex experience and country neighbours", () => {
  const index = new ContentIndex(
    snapshot(
      [
        article(1, ["moving", "thrilling"]),
        article(2, ["moving"]),
        article(3, ["moving", "thrilling"]),
        article(4, ["funny"]),
        article(5, []),
      ],
      {
        a1: ["bangkok"],
        a2: ["thailand"],
        // A roundup mostly about India that also covers Thailand.
        a3: ["india", "thailand"],
        a4: ["bangkok"],
      },
    ),
    NOW,
  );

  it("lists stories for one experience, newest first", () => {
    expect(index.withExperience("moving").map((v) => v.article.id)).toEqual(["a3", "a2", "a1"]);
  });

  it("ranks neighbours by shared experiences before recency", () => {
    // a3 shares two tags with a1, a2 only one; a4 and a5 share none.
    expect(index.sharingExperience("a1" as Article["id"]).map((v) => v.article.id)).toEqual([
      "a3",
      "a2",
    ]);
  });

  it("has no experience neighbours for an untagged article", () => {
    expect(index.sharingExperience("a5" as Article["id"])).toEqual([]);
  });

  it("finds same-country stories through city locations, primary ones first", () => {
    const id = "a1" as Article["id"];
    expect(index.countryOf(id)?.id).toBe("thailand");
    // a3 is newer than both but is primarily about India, so it comes last.
    expect(index.inSameCountry(id).map((v) => v.article.id)).toEqual(["a4", "a2", "a3"]);
    expect(
      index.inSameCountry(id, 3, new Set(["a4" as Article["id"]])).map((v) => v.article.id),
    ).toEqual(["a2", "a3"]);
  });
});
