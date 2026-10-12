import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  columnSql,
  ContentError,
  menuSql,
  newsSql,
  sqlValue,
  stableId,
  storeSql,
} from "../lib/seed";

const content = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`../../content/${name}.json`, import.meta.url), "utf8"),
  ) as Record<string, unknown>[];

describe("committed content", () => {
  it("passes validation and produces one upsert per entry", async () => {
    for (const [name, build] of [
      ["menus", menuSql],
      ["stores", storeSql],
      ["news", newsSql],
      ["columns", columnSql],
    ] as const) {
      const entries = content(name);
      const sql = await build(entries);
      expect(sql).toHaveLength(entries.length);
      for (const statement of sql)
        expect(statement).toMatch(/^INSERT INTO .+ ON CONFLICT\(\w+\) DO UPDATE SET /s);
    }
  });

  it("links columns only to the travel blog", () => {
    for (const column of content("columns"))
      expect(String(column.url)).toMatch(/^https:\/\/tomokichidiary\.com\/posts\//);
  });
});

describe("seed rules", () => {
  const base = content("menus")[0]!;

  it("refuses a rating or comment on a menu the editor has not tasted", async () => {
    await expect(menuSql([{ ...base, tasted: false }])).rejects.toBeInstanceOf(ContentError);
  });

  it("refuses unknown enum values and duplicate slugs", async () => {
    await expect(menuSql([{ ...base, teaBase: "coffee" }])).rejects.toThrow(/teaBase/);
    await expect(menuSql([base, base])).rejects.toThrow(/duplicate/);
  });

  it("requires a source for official or reported news", async () => {
    const news = content("news").find((n) => n.verificationStatus === "reported")!;
    await expect(newsSql([{ ...news, sources: [] }])).rejects.toThrow(/source/);
  });

  it("escapes SQL strings and derives stable ids", async () => {
    expect(sqlValue("it's")).toBe("'it''s'");
    expect(sqlValue(["a"])).toBe(`'["a"]'`);
    expect(sqlValue(true)).toBe("1");
    expect(await stableId("menu", "x")).toBe(await stableId("menu", "x"));
    expect(await stableId("menu", "x")).not.toBe(await stableId("store", "x"));
  });
});
