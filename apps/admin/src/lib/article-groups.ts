import type {
  ArticleSummaryDto,
  CollectionAdminDto,
  LocationDto,
  TaxonomyDto,
} from "@tomokichi/contracts";

export type GroupBy = "none" | "trip" | "country" | "category";
export const GROUP_OPTIONS: readonly { value: GroupBy; label: string }[] = [
  { value: "trip", label: "旅程・シリーズごと" },
  { value: "country", label: "国ごと" },
  { value: "category", label: "カテゴリーごと" },
  { value: "none", label: "まとめない（更新順）" },
];

export interface GroupNames {
  collections: readonly CollectionAdminDto[];
  locations: readonly LocationDto[];
  categories: TaxonomyDto["categories"];
}
export interface ArticleGroup {
  key: string;
  label: string;
  hint: string;
  items: ArticleSummaryDto[];
}

const REST = "￿";
const updated = (a: ArticleSummaryDto) => a.contentUpdatedAt ?? a.updatedAt;
const byUpdated = (a: ArticleSummaryDto, b: ArticleSummaryDto) =>
  updated(b).localeCompare(updated(a));
/** A trip reads in the order it was written: episode 1 first. */
const byPublished = (a: ArticleSummaryDto, b: ArticleSummaryDto) =>
  (a.publishedAt ?? REST).localeCompare(b.publishedAt ?? REST) ||
  a.slug.localeCompare(b.slug, "en", { numeric: true });

/** The country a location sits in (itself, when it is one or has no parent). */
function countryOf(id: string, locations: ReadonlyMap<string, LocationDto>) {
  let at = locations.get(id);
  for (let hops = 0; at && at.type !== "country" && at.parentId && hops < 8; hops += 1)
    at = locations.get(at.parentId);
  return at;
}

/** The names a reader would type to find this article by where it is filed. */
export function filedUnder(article: ArticleSummaryDto, names: GroupNames) {
  const collections = new Map(names.collections.map((c) => [c.id, c.title]));
  const locations = new Map(names.locations.map((l) => [l.id, l]));
  const categories = new Map(names.categories.map((c) => [c.id, c.name]));
  return [
    ...(article.collectionIds ?? []).map((id) => collections.get(id)),
    ...(article.locationIds ?? []).flatMap((id) => [
      locations.get(id)?.name,
      countryOf(id, locations)?.name,
    ]),
    ...(article.categoryIds ?? []).map((id) => categories.get(id)),
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * The list cut into the piles an author looks for an article in. One article
 * sits in one pile: its journey before its series, its first location's
 * country, its first category. Piles with the most recent work come first;
 * what is filed nowhere comes last.
 */
export function groupArticles(
  items: readonly ArticleSummaryDto[],
  by: GroupBy,
  names: GroupNames,
): ArticleGroup[] {
  if (by === "none") return [{ key: "all", label: "", hint: "", items: items.toSorted(byUpdated) }];
  const collections = new Map(names.collections.map((c) => [c.id, c]));
  const locations = new Map(names.locations.map((l) => [l.id, l]));
  const categories = new Map(names.categories.map((c) => [c.id, c.name]));
  const pileOf = (article: ArticleSummaryDto): Omit<ArticleGroup, "items"> | null => {
    if (by === "trip") {
      const mine = (article.collectionIds ?? []).flatMap((id) => collections.get(id) ?? []);
      const pick = mine.find((c) => c.kind === "journey") ?? mine[0];
      return pick
        ? { key: pick.id, label: pick.title, hint: pick.kind === "journey" ? "旅程" : "シリーズ" }
        : null;
    }
    if (by === "country") {
      const first = article.locationIds?.[0];
      const country = first ? countryOf(first, locations) : undefined;
      return country ? { key: country.id, label: country.name, hint: "" } : null;
    }
    const first = article.categoryIds?.[0];
    const name = first ? categories.get(first) : undefined;
    return first && name ? { key: first, label: name, hint: "" } : null;
  };
  const piles = new Map<string, ArticleGroup>();
  const rest: ArticleSummaryDto[] = [];
  for (const article of items) {
    const pile = pileOf(article);
    if (!pile) {
      rest.push(article);
      continue;
    }
    const group = piles.get(pile.key) ?? { ...pile, items: [] };
    group.items.push(article);
    piles.set(pile.key, group);
  }
  const latest = (group: ArticleGroup) =>
    group.items.reduce((max, a) => (updated(a) > max ? updated(a) : max), "");
  const groups = [...piles.values()].toSorted((a, b) => latest(b).localeCompare(latest(a)));
  for (const group of groups) group.items.sort(by === "trip" ? byPublished : byUpdated);
  if (rest.length > 0)
    groups.push({
      key: "rest",
      label:
        by === "trip" ? "どれにも入っていない" : by === "country" ? "国なし" : "カテゴリーなし",
      hint: "",
      items: rest.toSorted(byUpdated),
    });
  return groups;
}
