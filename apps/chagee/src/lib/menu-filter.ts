import {
  COUNTRIES,
  MENU_CATEGORIES,
  SWEETNESS,
  TEA_BASES,
  TEMPERATURES,
  type Country,
  type Menu,
  type MenuCategory,
  type Sweetness,
  type TeaBase,
  type Temperature,
} from "./types";

export const MENU_SORTS = ["popular", "beginner", "light", "sweet"] as const;
export type MenuSort = (typeof MENU_SORTS)[number];

export const MENU_SORT_LABEL: Record<MenuSort, string> = {
  popular: "人気順",
  beginner: "初心者向け",
  light: "さっぱり順",
  sweet: "甘め順",
};

export interface MenuQuery {
  q: string;
  category: MenuCategory | null;
  tea: TeaBase | null;
  sweet: Sweetness | null;
  milk: "yes" | "no" | null;
  temp: Temperature | null;
  country: Country | null;
  sort: MenuSort;
}

function pick<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/** Unknown values are dropped, so a hand-edited URL never errors. */
export function parseMenuQuery(params: URLSearchParams): MenuQuery {
  return {
    q: (params.get("q") ?? "").trim().slice(0, 50),
    category: pick(params.get("category"), MENU_CATEGORIES),
    tea: pick(params.get("tea"), TEA_BASES),
    sweet: pick(params.get("sweet"), SWEETNESS),
    milk: pick(params.get("milk"), ["yes", "no"] as const),
    temp: pick(params.get("temp"), TEMPERATURES),
    country: pick(params.get("country"), COUNTRIES),
    sort: pick(params.get("sort"), MENU_SORTS) ?? "popular",
  };
}

/** Lowercased, width-folded text for matching Japanese, Chinese and English names alike. */
export function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s·・]/g, "");
}

export function menuHaystack(menu: Menu): string {
  return normalize(
    [
      menu.nameJa,
      menu.nameZh,
      menu.nameEn ?? "",
      menu.shortDescription,
      menu.teaDetail,
      ...menu.aromaTags,
      ...menu.flavorTags,
    ].join(" "),
  );
}

const SWEET_RANK: Record<Sweetness, number> = { light: 0, normal: 1, sweet: 2 };

const byName = (a: Menu, b: Menu) => a.nameJa.localeCompare(b.nameJa, "ja");
// Menus not yet tasted have no editorial scores and sort after those that do.
const score = (value: number | null) => value ?? -1;
const sweet = (menu: Menu) => (menu.sweetness === null ? -1 : SWEET_RANK[menu.sweetness]);

export function filterMenus(menus: Menu[], query: MenuQuery): Menu[] {
  const needle = normalize(query.q);
  const kept = menus.filter(
    (menu) =>
      (needle === "" || menuHaystack(menu).includes(needle)) &&
      (query.category === null || menu.category === query.category) &&
      (query.tea === null || menu.teaBase === query.tea) &&
      (query.sweet === null || menu.sweetness === query.sweet) &&
      (query.milk === null || (menu.milkType !== "none") === (query.milk === "yes")) &&
      (query.temp === null || menu.temperatures.includes(query.temp)) &&
      (query.country === null || menu.availability.some((a) => a.country === query.country)),
  );
  const sorters: Record<MenuSort, (a: Menu, b: Menu) => number> = {
    popular: (a, b) =>
      Number(b.tasted) - Number(a.tasted) ||
      score(b.popularity) - score(a.popularity) ||
      byName(a, b),
    beginner: (a, b) =>
      Number(b.beginnerFriendly) - Number(a.beginnerFriendly) ||
      score(b.popularity) - score(a.popularity) ||
      byName(a, b),
    light: (a, b) => score(b.lightness) - score(a.lightness) || byName(a, b),
    sweet: (a, b) => sweet(b) - sweet(a) || score(a.lightness) - score(b.lightness) || byName(a, b),
  };
  return kept.toSorted(sorters[query.sort]);
}

/** Whether any narrowing (not sort) is active. */
export function isFiltered(query: MenuQuery): boolean {
  return (
    query.q !== "" ||
    query.category !== null ||
    query.tea !== null ||
    query.sweet !== null ||
    query.milk !== null ||
    query.temp !== null ||
    query.country !== null
  );
}

/**
 * The URL for toggling one filter value: selecting the active value clears it.
 * Everything else in the query is kept, so filters combine.
 */
export function toggleHref(
  path: string,
  params: URLSearchParams,
  key: string,
  value: string | null,
): string {
  const next = new URLSearchParams(params);
  if (value === null || next.get(key) === value) next.delete(key);
  else next.set(key, value);
  const query = next.toString();
  return query === "" ? path : `${path}?${query}`;
}

/** Menus that share a tea base or an aroma, best match first. */
export function relatedMenus(menu: Menu, menus: Menu[], limit = 3): Menu[] {
  const affinity = (other: Menu) =>
    (other.teaBase === menu.teaBase ? 2 : 0) +
    other.aromaTags.filter((tag) => menu.aromaTags.includes(tag)).length +
    (other.category === menu.category ? 1 : 0);
  return menus
    .filter((other) => other.slug !== menu.slug)
    .map((other) => ({ other, score: affinity(other) }))
    .toSorted((a, b) => b.score - a.score || (b.other.popularity ?? 0) - (a.other.popularity ?? 0))
    .slice(0, limit)
    .map(({ other }) => other);
}
