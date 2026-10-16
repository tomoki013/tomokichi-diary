import { normalize } from "./menu-filter";
import { COUNTRIES, type Country, type Store } from "./types";

export interface StoreQuery {
  q: string;
  country: Country | null;
  city: string | null;
  visited: boolean;
}

export function parseStoreQuery(params: URLSearchParams): StoreQuery {
  const country = params.get("country");
  const city = (params.get("city") ?? "").trim();
  return {
    q: (params.get("q") ?? "").trim().slice(0, 50),
    country:
      country !== null && (COUNTRIES as readonly string[]).includes(country)
        ? (country as Country)
        : null,
    city: city === "" ? null : city.slice(0, 30),
    visited: params.get("visited") === "1",
  };
}

export function filterStores(stores: Store[], query: StoreQuery): Store[] {
  const needle = normalize(query.q);
  return stores.filter(
    (store) =>
      (needle === "" ||
        normalize(
          [
            store.name,
            store.nameLocal ?? "",
            store.city,
            store.area,
            store.access ?? "",
            ...store.goodFor,
          ].join(" "),
        ).includes(needle)) &&
      (query.country === null || store.country === query.country) &&
      (query.city === null || store.city === query.city) &&
      (!query.visited || store.visited),
  );
}

/** Cities in the order they first appear, optionally within one country. */
export function citiesOf(stores: Store[], country: Country | null): string[] {
  return [
    ...new Set(stores.filter((s) => country === null || s.country === country).map((s) => s.city)),
  ];
}

/** Stores grouped by city, keeping list order. */
export function groupByCity(
  stores: Store[],
): { city: string; country: Country; stores: Store[] }[] {
  const groups = new Map<string, { city: string; country: Country; stores: Store[] }>();
  for (const store of stores) {
    const group = groups.get(store.city) ?? {
      city: store.city,
      country: store.country,
      stores: [],
    };
    group.stores.push(store);
    groups.set(store.city, group);
  }
  return [...groups.values()];
}
