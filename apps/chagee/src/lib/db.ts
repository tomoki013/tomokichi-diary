import { toColumnLink, toMenu, toNews, toStore, type Row } from "./rows";
import type { ColumnLink, Menu, News, Store } from "./types";

/**
 * Every read the site makes. The data set is small (tens of rows per table),
 * so lists are read whole and filtered in `menu-filter.ts` / `store-filter.ts`
 * rather than turned into dynamic SQL.
 */
export interface GuideRepository {
  menus(): Promise<Menu[]>;
  menu(slug: string): Promise<Menu | null>;
  stores(): Promise<Store[]>;
  store(slug: string): Promise<Store | null>;
  news(limit?: number): Promise<News[]>;
  newsItem(slug: string): Promise<News | null>;
  columns(): Promise<ColumnLink[]>;
}

async function all(db: D1Database, sql: string, ...params: unknown[]): Promise<Row[]> {
  const { results } = await db
    .prepare(sql)
    .bind(...params)
    .all<Row>();
  return results;
}

async function first(db: D1Database, sql: string, ...params: unknown[]): Promise<Row | null> {
  return db
    .prepare(sql)
    .bind(...params)
    .first<Row>();
}

export function createRepository(db: D1Database): GuideRepository {
  return {
    menus: async () =>
      (
        await all(
          db,
          "SELECT * FROM menus WHERE status = 'published' ORDER BY popularity DESC, name_ja",
        )
      ).map(toMenu),
    menu: async (slug) => {
      const row = await first(
        db,
        "SELECT * FROM menus WHERE slug = ? AND status = 'published'",
        slug,
      );
      return row ? toMenu(row) : null;
    },
    stores: async () =>
      (
        await all(
          db,
          "SELECT * FROM stores WHERE status = 'published' ORDER BY country, city, editor_pick DESC, name",
        )
      ).map(toStore),
    store: async (slug) => {
      const row = await first(
        db,
        "SELECT * FROM stores WHERE slug = ? AND status = 'published'",
        slug,
      );
      return row ? toStore(row) : null;
    },
    news: async (limit = 100) =>
      (
        await all(
          db,
          "SELECT * FROM news WHERE status = 'published' ORDER BY published_at DESC LIMIT ?",
          limit,
        )
      ).map(toNews),
    newsItem: async (slug) => {
      const row = await first(
        db,
        "SELECT * FROM news WHERE slug = ? AND status = 'published'",
        slug,
      );
      return row ? toNews(row) : null;
    },
    columns: async () =>
      (
        await all(
          db,
          "SELECT * FROM column_links WHERE status = 'published' ORDER BY sort_order, published_at DESC",
        )
      ).map(toColumnLink),
  };
}
