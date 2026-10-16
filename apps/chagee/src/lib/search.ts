import { menuHaystack, normalize } from "./menu-filter";
import type { ColumnLink, Menu, News, Store } from "./types";

export interface SearchResults {
  menus: Menu[];
  stores: Store[];
  news: News[];
  columns: ColumnLink[];
  total: number;
}

/**
 * Site-wide search over everything the guide holds. Every whitespace-separated
 * term must match (AND), so "上海 空港" narrows rather than widens.
 */
export function searchAll(
  q: string,
  data: { menus: Menu[]; stores: Store[]; news: News[]; columns: ColumnLink[] },
): SearchResults {
  const terms = q
    .split(/[\s　]+/)
    .map(normalize)
    .filter((term) => term !== "");
  const matches = (text: string) => terms.length > 0 && terms.every((t) => text.includes(t));

  const menus = data.menus.filter((menu) => matches(menuHaystack(menu)));
  const stores = data.stores.filter((store) =>
    matches(
      normalize(
        [
          store.name,
          store.nameLocal ?? "",
          store.city,
          store.area,
          store.access ?? "",
          ...store.goodFor,
        ].join(" "),
      ),
    ),
  );
  const news = data.news.filter((item) =>
    matches(normalize(`${item.title} ${item.summary} ${item.body}`)),
  );
  const columns = data.columns.filter((column) =>
    matches(normalize(`${column.title} ${column.excerpt}`)),
  );
  return {
    menus,
    stores,
    news,
    columns,
    total: menus.length + stores.length + news.length + columns.length,
  };
}
