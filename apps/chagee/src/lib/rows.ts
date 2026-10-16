import {
  COLUMN_CATEGORIES,
  COUNTRIES,
  type ColumnLink,
  type Country,
  type Link,
  type Menu,
  type News,
  type RegionNote,
  type Source,
  type Store,
  type Temperature,
  TEMPERATURES,
} from "./types";

/** D1 row shapes: snake_case, booleans as 0/1, lists as JSON text. */
export type Row = Record<string, unknown>;

function text(row: Row, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : String(value ?? "");
}

function nullable(row: Row, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value !== "" ? value : null;
}

function intOrNull(row: Row, key: string): number | null {
  const value = row[key];
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function int(row: Row, key: string): number {
  const value = Number(row[key]);
  return Number.isFinite(value) ? value : 0;
}

function bool(row: Row, key: string): boolean {
  return int(row, key) === 1;
}

/** A malformed JSON column reads as empty rather than taking the page down. */
export function jsonList<T>(raw: unknown, keep: (item: unknown) => item is T): T[] {
  if (typeof raw !== "string" || raw === "") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(keep) : [];
  } catch {
    return [];
  }
}

const isString = (item: unknown): item is string => typeof item === "string";
const isObject = (item: unknown): item is Record<string, unknown> =>
  typeof item === "object" && item !== null;
export const isCountry = (item: unknown): item is Country =>
  typeof item === "string" && (COUNTRIES as readonly string[]).includes(item);
const isTemperature = (item: unknown): item is Temperature =>
  typeof item === "string" && (TEMPERATURES as readonly string[]).includes(item);
const isRegionNote = (item: unknown): item is RegionNote =>
  isObject(item) && isCountry(item.country) && typeof item.note === "string";
const isLink = (item: unknown): item is Link =>
  isObject(item) && typeof item.title === "string" && typeof item.url === "string";
const isSource = (item: unknown): item is Source =>
  isObject(item) &&
  typeof item.name === "string" &&
  (item.url === undefined || typeof item.url === "string");

export function toMenu(row: Row): Menu {
  const rating = row.editor_rating;
  return {
    id: text(row, "id"),
    slug: text(row, "slug"),
    nameJa: text(row, "name_ja"),
    nameZh: text(row, "name_zh"),
    nameEn: nullable(row, "name_en"),
    shortDescription: text(row, "short_description"),
    description: text(row, "description"),
    imageKey: nullable(row, "image_key"),
    category: text(row, "category") as Menu["category"],
    teaBase: text(row, "tea_base") as Menu["teaBase"],
    teaDetail: text(row, "tea_detail"),
    milkType: text(row, "milk_type") as Menu["milkType"],
    sweetness: nullable(row, "sweetness") as Menu["sweetness"],
    lightness: intOrNull(row, "lightness"),
    popularity: intOrNull(row, "popularity"),
    temperatures: jsonList(row.temperatures, isTemperature),
    aromaTags: jsonList(row.aroma_tags, isString),
    flavorTags: jsonList(row.flavor_tags, isString),
    beginnerFriendly: bool(row, "beginner_friendly"),
    availability: jsonList(row.availability, isRegionNote),
    priceNotes: jsonList(row.price_notes, isRegionNote),
    recommendedFor: jsonList(row.recommended_for, isString),
    notRecommendedFor: jsonList(row.not_recommended_for, isString),
    tasted: bool(row, "tasted"),
    editorRating: rating === null || rating === undefined ? null : Number(rating),
    editorComment: nullable(row, "editor_comment"),
    blogLinks: jsonList(row.blog_links, isLink),
    sources: jsonList(row.sources, isSource),
    checkedAt: nullable(row, "checked_at"),
    updatedAt: text(row, "updated_at"),
  };
}

export function toStore(row: Row): Store {
  const country = row.country;
  return {
    id: text(row, "id"),
    slug: text(row, "slug"),
    name: text(row, "name"),
    nameLocal: nullable(row, "name_local"),
    country: isCountry(country) ? country : "cn",
    city: text(row, "city"),
    area: text(row, "area"),
    address: nullable(row, "address"),
    openingHours: nullable(row, "opening_hours"),
    access: nullable(row, "access"),
    mapUrl: nullable(row, "map_url"),
    mapLabel: nullable(row, "map_label"),
    features: jsonList(row.features, isString),
    cautions: jsonList(row.cautions, isString),
    goodFor: jsonList(row.good_for, isString),
    ordering: nullable(row, "ordering"),
    editorComment: nullable(row, "editor_comment"),
    visited: bool(row, "visited"),
    visitedOn: nullable(row, "visited_on"),
    editorPick: bool(row, "editor_pick"),
    imageKeys: jsonList(row.image_keys, isString),
    blogLinks: jsonList(row.blog_links, isLink),
    checkedAt: nullable(row, "checked_at"),
    updatedAt: text(row, "updated_at"),
  };
}

export function toNews(row: Row): News {
  return {
    id: text(row, "id"),
    slug: text(row, "slug"),
    title: text(row, "title"),
    summary: text(row, "summary"),
    body: text(row, "body"),
    category: text(row, "category") as News["category"],
    verificationStatus: text(row, "verification_status") as News["verificationStatus"],
    sources: jsonList(row.sources, isSource),
    coverKey: nullable(row, "cover_key"),
    publishedAt: text(row, "published_at"),
    updatedAt: text(row, "updated_at"),
  };
}

export function toColumnLink(row: Row): ColumnLink {
  const country = row.country;
  const category = text(row, "category");
  return {
    id: text(row, "id"),
    title: text(row, "title"),
    excerpt: text(row, "excerpt"),
    url: text(row, "url"),
    category: (COLUMN_CATEGORIES as readonly string[]).includes(category)
      ? (category as ColumnLink["category"])
      : "report",
    country: isCountry(country) ? country : null,
    sortOrder: int(row, "sort_order"),
    publishedAt: text(row, "published_at"),
    updatedAt: text(row, "updated_at"),
  };
}
