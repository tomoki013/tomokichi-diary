import { describe, expect, it } from "vitest";
import { listPublicArticles, paginate, type RelationIndex } from "../rules/listing.js";
import { findRelatedArticles } from "../rules/related.js";
import { LocationTree } from "../rules/location-tree.js";
import type { Location, LocationName } from "../entities/location.js";
import {
  asId,
  type CategoryId,
  type LocationId,
  type PlaceId,
  type RevisionId,
  type TagId,
} from "../primitives/id.js";
import type { Slug } from "../primitives/slug.js";
import { NOW, articleId, at, makeArticle } from "./fixtures.js";

const published = (n: number, publishedAt: string) =>
  makeArticle({
    id: articleId(n),
    status: "published",
    publishedRevisionId: asId<RevisionId>(`rev-${n}`),
    publishedAt: at(publishedAt),
    updatedAt: at(publishedAt),
  });

const articles = [
  published(1, "2026-08-01T00:00:00.000Z"),
  published(2, "2026-08-20T00:00:00.000Z"),
  published(3, "2026-08-10T00:00:00.000Z"),
  makeArticle({ id: articleId(4) }),
  published(5, "2027-01-01T00:00:00.000Z"),
];

const relations: RelationIndex = {
  categories: [
    { articleId: articleId(1), categoryId: asId<CategoryId>("cat-tourism") },
    { articleId: articleId(2), categoryId: asId<CategoryId>("cat-tourism") },
    { articleId: articleId(3), categoryId: asId<CategoryId>("cat-itinerary") },
  ],
  tags: [{ articleId: articleId(1), tagId: asId<TagId>("tag-chagee") }],
  locations: [
    { articleId: articleId(1), locationId: asId<LocationId>("loc-shanghai"), relation: "primary" },
    {
      articleId: articleId(2),
      locationId: asId<LocationId>("loc-shanghai"),
      relation: "mentioned",
    },
    { articleId: articleId(3), locationId: asId<LocationId>("loc-kyoto"), relation: "primary" },
  ],
  places: [
    { articleId: articleId(1), placeId: asId<PlaceId>("place-chagee-1"), relation: "visited" },
  ],
};

describe("listPublicArticles", () => {
  it("hides drafts and future publications, newest first", () => {
    const result = listPublicArticles({ articles, now: NOW });
    expect(result.map((a) => a.id)).toEqual([articleId(2), articleId(3), articleId(1)]);
  });

  it("sorts ascending and by update time on request", () => {
    expect(
      listPublicArticles({ articles, now: NOW, sort: "published_asc" }).map((a) => a.id),
    ).toEqual([articleId(1), articleId(3), articleId(2)]);
    expect(listPublicArticles({ articles, now: NOW, sort: "updated_desc" })[0]?.id).toBe(
      articleId(2),
    );
  });

  it("filters by category, tag, place and location", () => {
    const by = (filter: Parameters<typeof listPublicArticles>[0]["filter"]) =>
      listPublicArticles({ articles, relations, filter, now: NOW }).map((a) => a.id);

    expect(by({ categoryId: asId<CategoryId>("cat-tourism") })).toEqual([
      articleId(2),
      articleId(1),
    ]);
    expect(by({ tagId: asId<TagId>("tag-chagee") })).toEqual([articleId(1)]);
    expect(by({ placeId: asId<PlaceId>("place-chagee-1") })).toEqual([articleId(1)]);
    expect(by({ locationId: asId<LocationId>("loc-shanghai") })).toEqual([
      articleId(2),
      articleId(1),
    ]);
  });

  it("includes descendant locations so a country page lists its cities", () => {
    const result = listPublicArticles({
      articles,
      relations,
      filter: {
        locationId: asId<LocationId>("loc-japan"),
        locationDescendants: [asId<LocationId>("loc-kyoto")],
      },
      now: NOW,
    });
    expect(result.map((a) => a.id)).toEqual([articleId(3)]);
  });
});

describe("paginate", () => {
  it("reports totals and whether more pages exist", () => {
    const page = paginate([1, 2, 3, 4, 5], 2, 2);
    expect(page).toMatchObject({ items: [3, 4], total: 5, offset: 2, limit: 2, hasMore: true });
    expect(paginate([1, 2, 3], 2, 2).hasMore).toBe(false);
  });

  it("clamps hostile input", () => {
    expect(paginate([1, 2, 3], -10, 10_000).limit).toBe(100);
    expect(paginate([1, 2, 3], -10, 1).offset).toBe(0);
  });
});

describe("findRelatedArticles", () => {
  it("ranks by shared entities and never returns the source article", () => {
    const related = findRelatedArticles({ articleId: articleId(1), articles, relations, now: NOW });
    expect(related.map((r) => r.articleId)).toEqual([articleId(2)]);
    expect(related[0]?.reasons).toContain("location");
  });

  it("returns nothing when no entity is shared", () => {
    expect(findRelatedArticles({ articleId: articleId(3), articles, relations, now: NOW })).toEqual(
      [],
    );
  });
});

const location = (id: string, type: Location["type"], parentId: string | null): Location => ({
  id: asId<LocationId>(id),
  slug: id as Slug,
  type,
  parentId: parentId ? asId<LocationId>(parentId) : null,
  countryCode: null,
  subdivisionCode: null,
  latitude: null,
  longitude: null,
  timezone: null,
});

describe("LocationTree", () => {
  const locations = [
    location("asia", "continent", null),
    location("japan", "country", "asia"),
    location("kyoto", "prefecture", "japan"),
    location("gion", "district", "kyoto"),
  ];
  const names: LocationName[] = [
    {
      locationId: asId<LocationId>("kyoto"),
      locale: "ja",
      name: "京都",
      shortName: null,
      romanizedName: "Kyoto",
    },
  ];
  const tree = new LocationTree(locations, names);

  it("walks ancestors root-first for breadcrumbs", () => {
    expect(tree.ancestors(asId<LocationId>("gion")).map((l) => l.id)).toEqual([
      "asia",
      "japan",
      "kyoto",
    ]);
  });

  it("collects descendants for hub pages", () => {
    expect(tree.descendantIds(asId<LocationId>("japan"))).toEqual(["kyoto", "gion"]);
  });

  it("finds the country of any node", () => {
    expect(tree.countryOf(asId<LocationId>("gion"))?.id).toBe("japan");
    expect(tree.countryOf(asId<LocationId>("japan"))?.id).toBe("japan");
    expect(tree.countryOf(asId<LocationId>("asia"))).toBeUndefined();
  });

  it("falls back to the slug when a translation is missing", () => {
    expect(tree.nameOf(asId<LocationId>("kyoto"), "ja")).toBe("京都");
    expect(tree.nameOf(asId<LocationId>("kyoto"), "en")).toBe("kyoto");
  });

  it("does not hang on a cyclic parent reference", () => {
    const cyclic = new LocationTree([
      { ...location("a", "city", "b") },
      { ...location("b", "city", "a") },
    ]);
    expect(cyclic.ancestors(asId<LocationId>("a")).length).toBeLessThanOrEqual(2);
  });
});
