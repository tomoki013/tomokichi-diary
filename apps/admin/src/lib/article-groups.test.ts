import { describe, expect, it } from "vitest";
import type { ArticleSummaryDto, CollectionAdminDto, LocationDto } from "@tomokichi/contracts";
import { filedUnder, groupArticles, type GroupNames } from "./article-groups";

const article = (patch: Partial<ArticleSummaryDto> & { id: string }): ArticleSummaryDto =>
  ({
    kind: "article",
    slug: patch.id,
    title: patch.id,
    status: "published",
    locale: "ja",
    path: `/posts/${patch.id}`,
    publishedAt: null,
    scheduledAt: null,
    updatedAt: "2026-01-01T00:00:00Z",
    hasUnpublishedChanges: false,
    isLive: true,
    noindex: false,
    ...patch,
  }) as ArticleSummaryDto;
const collection = (id: string, kind: "series" | "journey", title: string) =>
  ({ id, kind, title, slug: id }) as CollectionAdminDto;
const location = (id: string, type: string, name: string, parentId: string | null = null) =>
  ({ id, type, name, slug: id, parentId }) satisfies LocationDto;

const names: GroupNames = {
  collections: [
    collection("europe", "journey", "ヨーロッパ周遊"),
    collection("china", "journey", "上海の旅"),
    collection("cafes", "series", "カフェめぐり"),
  ],
  locations: [
    location("fr", "country", "フランス"),
    location("paris", "city", "パリ", "fr"),
    location("cn", "country", "中国"),
    location("shanghai", "city", "上海", "cn"),
  ],
  categories: [{ id: "diary", slug: "diary", name: "旅行記" }],
};

const items = [
  article({
    id: "france2",
    collectionIds: ["europe"],
    locationIds: ["paris"],
    publishedAt: "2025-07-02T00:00:00Z",
    updatedAt: "2026-02-01T00:00:00Z",
  }),
  article({
    id: "france1",
    collectionIds: ["cafes", "europe"],
    locationIds: ["paris"],
    categoryIds: ["diary"],
    publishedAt: "2025-07-01T00:00:00Z",
  }),
  article({
    id: "china1",
    collectionIds: ["china"],
    locationIds: ["shanghai"],
    updatedAt: "2026-03-01T00:00:00Z",
  }),
  article({ id: "packing", updatedAt: "2026-04-01T00:00:00Z" }),
];

describe("groupArticles", () => {
  it("files each article under its journey, in the order the trip was written", () => {
    const groups = groupArticles(items, "trip", names);
    expect(groups.map((g) => [g.label, g.items.map((a) => a.id)])).toEqual([
      ["上海の旅", ["china1"]],
      ["ヨーロッパ周遊", ["france1", "france2"]],
      ["どれにも入っていない", ["packing"]],
    ]);
    expect(groups[0]!.hint).toBe("旅程");
  });

  it("files by the country of the first location", () => {
    const groups = groupArticles(items, "country", names);
    expect(groups.map((g) => [g.label, g.items.length])).toEqual([
      ["中国", 1],
      ["フランス", 2],
      ["国なし", 1],
    ]);
  });

  it("keeps one flat list, newest work first, when not grouping", () => {
    const [all] = groupArticles(items, "none", names);
    expect(all!.items.map((a) => a.id)).toEqual(["packing", "china1", "france2", "france1"]);
  });

  it("lets the filter find an article by where it is filed", () => {
    expect(filedUnder(items[1]!, names)).toContain("ヨーロッパ周遊");
    expect(filedUnder(items[1]!, names)).toContain("フランス");
    expect(filedUnder(items[1]!, names)).toContain("旅行記");
  });
});
