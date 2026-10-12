/**
 * Turns the committed content files (content/*.json) into idempotent SQL for
 * D1. Rows are keyed by slug (or URL for column links), so re-running updates
 * rows in place instead of duplicating them. Pure: the script does the I/O.
 */
import {
  COLUMN_CATEGORIES,
  COUNTRIES,
  MENU_CATEGORIES,
  MILK_TYPES,
  NEWS_CATEGORIES,
  SWEETNESS,
  TEA_BASES,
  TEMPERATURES,
  VERIFICATION,
} from "./types";

type Json = Record<string, unknown>;

export class ContentError extends Error {}

function need(entry: Json, where: string, key: string): unknown {
  const value = entry[key];
  if (value === undefined) throw new ContentError(`${where}: "${key}" is missing`);
  return value;
}

function str(entry: Json, where: string, key: string): string {
  const value = need(entry, where, key);
  if (typeof value !== "string" || value.trim() === "")
    throw new ContentError(`${where}: "${key}" must be a non-empty string`);
  return value;
}

function opt(entry: Json, where: string, key: string): string | null {
  const value = entry[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string")
    throw new ContentError(`${where}: "${key}" must be a string or null`);
  return value;
}

function oneOf<T extends string>(
  entry: Json,
  where: string,
  key: string,
  allowed: readonly T[],
): T {
  const value = str(entry, where, key);
  if (!(allowed as readonly string[]).includes(value))
    throw new ContentError(
      `${where}: "${key}" must be one of ${allowed.join(", ")} (got "${value}")`,
    );
  return value as T;
}

function scale(entry: Json, where: string, key: string): number {
  const value = need(entry, where, key);
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 5)
    throw new ContentError(`${where}: "${key}" must be an integer 1-5`);
  return value;
}

function list(
  entry: Json,
  where: string,
  key: string,
  check?: (item: unknown) => boolean,
): unknown[] {
  const value = entry[key] ?? [];
  if (!Array.isArray(value)) throw new ContentError(`${where}: "${key}" must be an array`);
  if (check && !value.every(check))
    throw new ContentError(`${where}: "${key}" has an invalid item`);
  return value;
}

function date(entry: Json, where: string, key: string, optional = false): string | null {
  const value = optional ? opt(entry, where, key) : str(entry, where, key);
  if (value !== null && !/^\d{4}-\d{2}-\d{2}/.test(value))
    throw new ContentError(`${where}: "${key}" must be an ISO date`);
  return value;
}

function url(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

const isCountry = (v: unknown) =>
  typeof v === "string" && (COUNTRIES as readonly string[]).includes(v);
const isRegionNote = (v: unknown) =>
  typeof v === "object" &&
  v !== null &&
  isCountry((v as Json).country) &&
  typeof (v as Json).note === "string";
const isLink = (v: unknown) =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as Json).title === "string" &&
  url((v as Json).url);
const isSource = (v: unknown) =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as Json).name === "string" &&
  ((v as Json).url === undefined || url((v as Json).url));
const isString = (v: unknown) => typeof v === "string";

/** A stable id from a natural key, shaped like a UUID. */
export async function stableId(kind: string, key: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${kind}:${key}`)),
  );
  const hex = Array.from(digest.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function sqlValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return `'${text.replaceAll("'", "''")}'`;
}

function upsert(table: string, row: Record<string, unknown>, conflict: string): string {
  const columns = Object.keys(row);
  const updates = columns
    .filter((c) => c !== "id" && c !== conflict)
    .map((c) => `${c} = excluded.${c}`);
  return `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns
    .map((c) => sqlValue(row[c]))
    .join(", ")}) ON CONFLICT(${conflict}) DO UPDATE SET ${updates.join(", ")};`;
}

function unique(values: string[], what: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new ContentError(`duplicate ${what}: ${value}`);
    seen.add(value);
  }
}

export async function menuSql(entries: Json[]): Promise<string[]> {
  unique(
    entries.map((e) => String(e.slug)),
    "menu slug",
  );
  return Promise.all(
    entries.map(async (e, i) => {
      const where = `menus[${i}]`;
      const slug = str(e, where, "slug");
      if (!/^[a-z0-9-]+$/.test(slug)) throw new ContentError(`${where}: slug must be kebab-case`);
      const tasted = need(e, where, "tasted") === true;
      const rating = e.editorRating ?? null;
      if (!tasted && (rating !== null || opt(e, where, "editorComment") !== null))
        throw new ContentError(`${where}: rating and comment are only for menus the editor tasted`);
      return upsert(
        "menus",
        {
          id: await stableId("menu", slug),
          slug,
          status: e.status ?? "published",
          name_ja: str(e, where, "nameJa"),
          name_zh: str(e, where, "nameZh"),
          name_en: str(e, where, "nameEn"),
          short_description: str(e, where, "shortDescription"),
          description: str(e, where, "description"),
          image_key: opt(e, where, "imageKey"),
          category: oneOf(e, where, "category", MENU_CATEGORIES),
          tea_base: oneOf(e, where, "teaBase", TEA_BASES),
          tea_detail: str(e, where, "teaDetail"),
          milk_type: oneOf(e, where, "milkType", MILK_TYPES),
          sweetness: oneOf(e, where, "sweetness", SWEETNESS),
          lightness: scale(e, where, "lightness"),
          popularity: scale(e, where, "popularity"),
          temperatures: list(e, where, "temperatures", (v) =>
            (TEMPERATURES as readonly unknown[]).includes(v),
          ),
          aroma_tags: list(e, where, "aromaTags", isString),
          flavor_tags: list(e, where, "flavorTags", isString),
          beginner_friendly: e.beginnerFriendly === true,
          availability: list(e, where, "availability", isRegionNote),
          price_notes: list(e, where, "priceNotes", isRegionNote),
          recommended_for: list(e, where, "recommendedFor", isString),
          not_recommended_for: list(e, where, "notRecommendedFor", isString),
          tasted,
          editor_rating: rating === null ? null : scale(e, where, "editorRating"),
          editor_comment: opt(e, where, "editorComment"),
          blog_links: list(e, where, "blogLinks", isLink),
          sources: list(e, where, "sources", isSource),
          checked_at: date(e, where, "checkedAt", true),
          updated_at: date(e, where, "updatedAt"),
        },
        "slug",
      );
    }),
  );
}

export async function storeSql(entries: Json[]): Promise<string[]> {
  unique(
    entries.map((e) => String(e.slug)),
    "store slug",
  );
  return Promise.all(
    entries.map(async (e, i) => {
      const where = `stores[${i}]`;
      const slug = str(e, where, "slug");
      const mapUrl = opt(e, where, "mapUrl");
      if (mapUrl !== null && !url(mapUrl)) throw new ContentError(`${where}: mapUrl must be https`);
      return upsert(
        "stores",
        {
          id: await stableId("store", slug),
          slug,
          status: e.status ?? "published",
          name: str(e, where, "name"),
          name_local: opt(e, where, "nameLocal"),
          country: oneOf(e, where, "country", COUNTRIES),
          city: str(e, where, "city"),
          area: str(e, where, "area"),
          address: opt(e, where, "address"),
          opening_hours: opt(e, where, "openingHours"),
          access: opt(e, where, "access"),
          map_url: mapUrl,
          map_label: opt(e, where, "mapLabel"),
          features: list(e, where, "features", isString),
          cautions: list(e, where, "cautions", isString),
          good_for: list(e, where, "goodFor", isString),
          ordering: opt(e, where, "ordering"),
          editor_comment: opt(e, where, "editorComment"),
          visited: e.visited === true,
          visited_on: date(e, where, "visitedOn", true),
          editor_pick: e.editorPick === true,
          image_keys: list(e, where, "imageKeys", isString),
          blog_links: list(e, where, "blogLinks", isLink),
          checked_at: date(e, where, "checkedAt", true),
          updated_at: date(e, where, "updatedAt"),
        },
        "slug",
      );
    }),
  );
}

export async function newsSql(entries: Json[]): Promise<string[]> {
  unique(
    entries.map((e) => String(e.slug)),
    "news slug",
  );
  return Promise.all(
    entries.map(async (e, i) => {
      const where = `news[${i}]`;
      const slug = str(e, where, "slug");
      const status = oneOf(e, where, "verificationStatus", VERIFICATION);
      const sources = list(e, where, "sources", isSource);
      if (status !== "unverified" && sources.length === 0)
        throw new ContentError(`${where}: official or reported news needs at least one source`);
      return upsert(
        "news",
        {
          id: await stableId("news", slug),
          slug,
          status: e.status ?? "published",
          title: str(e, where, "title"),
          summary: str(e, where, "summary"),
          body: str(e, where, "body"),
          category: oneOf(e, where, "category", NEWS_CATEGORIES),
          verification_status: status,
          sources,
          cover_key: opt(e, where, "coverKey"),
          published_at: date(e, where, "publishedAt"),
          updated_at: date(e, where, "updatedAt"),
        },
        "slug",
      );
    }),
  );
}

export async function columnSql(entries: Json[]): Promise<string[]> {
  unique(
    entries.map((e) => String(e.url)),
    "column url",
  );
  return Promise.all(
    entries.map(async (e, i) => {
      const where = `columns[${i}]`;
      const link = str(e, where, "url");
      if (!url(link)) throw new ContentError(`${where}: url must be https`);
      const country = e.country ?? null;
      if (country !== null && !isCountry(country))
        throw new ContentError(`${where}: unknown country`);
      return upsert(
        "column_links",
        {
          id: await stableId("column", link),
          status: e.status ?? "published",
          title: str(e, where, "title"),
          excerpt: str(e, where, "excerpt"),
          url: link,
          category: oneOf(e, where, "category", COLUMN_CATEGORIES),
          country,
          sort_order: typeof e.sortOrder === "number" ? e.sortOrder : 0,
          published_at: date(e, where, "publishedAt"),
          updated_at: date(e, where, "updatedAt"),
        },
        "url",
      );
    }),
  );
}
