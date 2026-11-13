import { describe, expect, it } from "vitest";
import { formatSearchWords, parseSearchWords } from "./search-words";

describe("search words text", () => {
  it("reads one word per line with its other spellings", () => {
    const { items, problems } = parseSearchWords(
      "CHAGEE = チャジー、霸王茶姬\n\nMirador del Valle ＝ ミラドール・デル・バジェ, ミラドール・デル・バイェ\n",
    );
    expect(problems).toEqual([]);
    expect(items).toEqual([
      { word: "CHAGEE", also: ["チャジー", "霸王茶姬"] },
      { word: "Mirador del Valle", also: ["ミラドール・デル・バジェ", "ミラドール・デル・バイェ"] },
    ]);
  });

  it("reports a line it cannot read instead of dropping it", () => {
    const { items, problems } = parseSearchWords("CHAGEE\nKL = クアラルンプール");
    expect(items).toEqual([{ word: "KL", also: ["クアラルンプール"] }]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("1行目");
  });

  it("writes back what it reads", () => {
    const text = "CHAGEE = チャジー、霸王茶姬\nKL = クアラルンプール";
    expect(formatSearchWords(parseSearchWords(text).items)).toBe(text);
  });
});
