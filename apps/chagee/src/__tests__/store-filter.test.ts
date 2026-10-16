import { describe, expect, it } from "vitest";
import { citiesOf, filterStores, groupByCity, parseStoreQuery } from "../lib/store-filter";
import { store } from "./fixtures";

const stores = [
  store(),
  store({
    slug: "pudong",
    name: "浦東空港S2国際店",
    area: "上海浦東国際空港",
    goodFor: ["帰国前"],
  }),
  store({
    slug: "wolo",
    name: "CHAGEE • WOLO KL",
    country: "my",
    city: "クアラルンプール",
    area: "Bukit Bintang",
    visited: false,
  }),
];

describe("store filters", () => {
  const run = (search: string) =>
    filterStores(stores, parseStoreQuery(new URLSearchParams(search))).map((s) => s.slug);

  it("filters by country, city, keyword and visited", () => {
    expect(run("country=my")).toEqual(["wolo"]);
    expect(run("city=上海")).toEqual(["yuyuan", "pudong"]);
    expect(run("q=空港")).toEqual(["pudong"]);
    expect(run("q=bukit")).toEqual(["wolo"]);
    expect(run("visited=1")).toEqual(["yuyuan", "pudong"]);
  });

  it("ignores an unknown country", () => {
    expect(run("country=zz")).toHaveLength(3);
  });

  it("lists cities within a country and groups in order", () => {
    expect(citiesOf(stores, null)).toEqual(["上海", "クアラルンプール"]);
    expect(citiesOf(stores, "my")).toEqual(["クアラルンプール"]);
    expect(groupByCity(stores).map((g) => [g.city, g.stores.length])).toEqual([
      ["上海", 2],
      ["クアラルンプール", 1],
    ]);
  });
});
