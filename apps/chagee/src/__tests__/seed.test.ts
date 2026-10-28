import { describe, expect, it } from "vitest";
import { sqlValue, stableId } from "../lib/seed";

describe("seed rules", () => {
  it("escapes SQL strings and derives stable ids", async () => {
    expect(sqlValue("it's")).toBe("'it''s'");
    expect(sqlValue(["a"])).toBe(`'["a"]'`);
    expect(sqlValue(true)).toBe("1");
    expect(await stableId("menu", "x")).toBe(await stableId("menu", "x"));
    expect(await stableId("menu", "x")).not.toBe(await stableId("store", "x"));
  });
});
