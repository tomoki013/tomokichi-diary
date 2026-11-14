import { describe, expect, it } from "vitest";
import { matchScore, normalizeSearch, searchTerms, searchWordsFor } from "../lib/archive-search";

const card = (title: string, slug: string, rest = "") => ({
  heading: normalizeSearch(`${title} ${slug}`),
  text: normalizeSearch(`${title} ${slug} ${rest}`),
});
const score = (c: ReturnType<typeof card>, query: string) =>
  matchScore(c.heading, c.text, searchTerms(query));

describe("archive search", () => {
  const france = card(
    "パリ初日、凱旋門まで歩いた",
    "france1",
    "フランス パリ 旅行記 ヨーロッパ周遊",
  );
  const chagee = card(
    "CHAGEEで頼むならこれ！",
    "shanghai-chagee-menu",
    "中国 上海 チャジー カフェ",
  );

  it("finds an article by its slug", () => {
    expect(score(france, "france1")).toBeGreaterThan(0);
    expect(score(france, "France1")).toBeGreaterThan(0);
    expect(score(france, "france 1")).toBeGreaterThan(0);
    expect(score(chagee, "shanghai-chagee-menu")).toBeGreaterThan(0);
    expect(score(chagee, "france1")).toBe(0);
  });

  it("folds width, case and kana", () => {
    expect(score(chagee, "ｃｈａｇｅｅ")).toBeGreaterThan(0);
    expect(score(chagee, "ちゃじー")).toBeGreaterThan(0);
    expect(score(france, "ふらんす")).toBeGreaterThan(0);
  });

  it("needs every word, in any order", () => {
    expect(score(france, "パリ 凱旋門")).toBeGreaterThan(0);
    expect(score(france, "凱旋門　パリ")).toBeGreaterThan(0);
    expect(score(france, "パリ 上海")).toBe(0);
  });

  it("ranks a title or slug match above a match in the rest", () => {
    const inTitle = card("上海のCHAGEE 3店舗", "shanghai-chagee-stores");
    const inTags = card("中国旅行の持ち物", "china-packing", "上海 北京");
    expect(score(inTitle, "上海")).toBeGreaterThan(score(inTags, "上海"));
    expect(score(france, "france1")).toBeGreaterThan(score(france, "フランス"));
  });

  it("puts the article a spaced-out slug names ahead of its neighbours", () => {
    const second = card("パリ2日目、1日でルーヴルを回った", "france2", "フランス パリ");
    expect(score(second, "france 1")).toBeGreaterThan(0);
    expect(score(france, "france 1")).toBeGreaterThan(score(second, "france 1"));
  });

  it("matches everything for an empty query", () => {
    expect(score(france, "  ")).toBeGreaterThan(0);
  });

  describe("search-only words", () => {
    const words = [
      { word: "CHAGEE", also: ["チャジー", "霸王茶姬"] },
      { word: "Mirador del Valle", also: ["ミラドール・デル・バジェ", "ミラドール・デル・バイェ"] },
    ];
    const withWords = (title: string, slug: string, body: string) => {
      const base = card(title, slug);
      const extra = searchWordsFor(`${title} ${body}`, words).join(" ");
      return { heading: base.heading, text: `${base.text} ${extra}` };
    };

    it("finds an article by a reading it never spells out", () => {
      const menu = withWords("CHAGEEで頼むならこれ！", "shanghai-chagee-menu", "");
      expect(score(menu, "ちゃじー")).toBeGreaterThan(0);
      expect(score(menu, "チャジー おすすめ")).toBe(0);
      expect(score(menu, "霸王茶姬")).toBeGreaterThan(0);
    });

    it("finds an article that only mentions the word in its body", () => {
      const toledo = withWords(
        "トレドで夜景を見た日",
        "spain5",
        "夕方、Mirador del Valle まで歩いた。",
      );
      expect(score(toledo, "みらどーるでるばいえ")).toBeGreaterThan(0);
      expect(score(toledo, "ミラドール デル バジェ")).toBeGreaterThan(0);
      expect(score(toledo, "ちゃじー")).toBe(0);
    });

    it("leaves articles that never mention the word alone", () => {
      expect(searchWordsFor("パリ初日、凱旋門まで歩いた", words)).toEqual([]);
    });
  });
});
