import { describe, expect, it } from "vitest";
import {
  filterMenus,
  isFiltered,
  parseMenuQuery,
  relatedMenus,
  toggleHref,
} from "../lib/menu-filter";
import { menu } from "./fixtures";

const jasmine = menu();
const daHongPao = menu({
  slug: "dhp",
  nameJa: "白霧紅塵",
  nameZh: "白雾红尘",
  nameEn: "Da Hong Pao Milk Tea",
  teaBase: "oolong",
  aromaTags: ["焙煎香"],
  lightness: 1,
  popularity: 4,
  beginnerFriendly: false,
  temperatures: ["iced"],
  availability: [{ country: "cn", note: "" }],
});
const peach = menu({
  slug: "peach",
  nameJa: "花田烏龍",
  nameZh: "花田乌龙",
  nameEn: "White Peach Oolong Milk Tea",
  teaBase: "oolong",
  aromaTags: ["白桃"],
  lightness: 4,
  popularity: 3,
  sweetness: "sweet",
  temperatures: ["iced"],
  availability: [{ country: "my", note: "" }],
});
const all = [daHongPao, peach, jasmine];

describe("parseMenuQuery", () => {
  it("drops unknown values instead of failing", () => {
    const query = parseMenuQuery(
      new URLSearchParams("tea=coffee&sort=random&country=xx&milk=maybe"),
    );
    expect(query).toMatchObject({ tea: null, sort: "popular", country: null, milk: null });
    expect(isFiltered(query)).toBe(false);
  });

  it("caps the free-text query", () => {
    expect(parseMenuQuery(new URLSearchParams(`q=${"a".repeat(80)}`)).q).toHaveLength(50);
  });
});

describe("filterMenus", () => {
  const run = (search: string) =>
    filterMenus(all, parseMenuQuery(new URLSearchParams(search))).map((m) => m.slug);

  it("sorts by popularity by default", () => {
    expect(run("")).toEqual(["jasmine", "dhp", "peach"]);
  });

  it("matches Japanese, Chinese and English names regardless of width and case", () => {
    expect(run("q=白雾")).toEqual(["dhp"]);
    expect(run("q=ＪＡＳＭＩＮＥ")).toEqual(["jasmine"]);
    expect(run("q=da hong pao")).toEqual(["dhp"]);
  });

  it("combines filters", () => {
    expect(run("tea=oolong&country=cn")).toEqual(["dhp"]);
    expect(run("temp=hot")).toEqual(["jasmine"]);
    expect(run("milk=no")).toEqual([]);
  });

  it("orders lighter drinks first for さっぱり順 and sweeter first for 甘め順", () => {
    expect(run("sort=light").at(-1)).toBe("dhp");
    expect(run("sort=sweet")[0]).toBe("peach");
  });

  it("sorts menus without tasting scores after tasted ones", () => {
    const official = menu({
      slug: "official",
      nameJa: "青沫観音",
      tasted: false,
      popularity: null,
      lightness: null,
      sweetness: null,
      beginnerFriendly: false,
    });
    const list = [official, ...all];
    const sorted = (search: string) =>
      filterMenus(list, parseMenuQuery(new URLSearchParams(search))).map((m) => m.slug);
    expect(sorted("").at(-1)).toBe("official");
    expect(sorted("sort=light").at(-1)).toBe("official");
    expect(sorted("sort=sweet").at(-1)).toBe("official");
    expect(sorted("sweet=normal")).not.toContain("official");
  });

  it("puts beginner-friendly drinks first for 初心者向け", () => {
    expect(run("sort=beginner").at(-1)).toBe("dhp");
  });
});

describe("toggleHref", () => {
  it("adds, replaces and clears a value while keeping the rest", () => {
    const params = new URLSearchParams("tea=oolong&sort=light");
    expect(toggleHref("/menu", params, "tea", "jasmine")).toBe("/menu?tea=jasmine&sort=light");
    expect(toggleHref("/menu", params, "tea", "oolong")).toBe("/menu?sort=light");
    expect(toggleHref("/menu", new URLSearchParams("tea=oolong"), "tea", "oolong")).toBe("/menu");
  });
});

describe("relatedMenus", () => {
  it("prefers the same tea base and never returns the menu itself", () => {
    const related = relatedMenus(daHongPao, all).map((m) => m.slug);
    expect(related[0]).toBe("peach");
    expect(related).not.toContain("dhp");
  });
});
