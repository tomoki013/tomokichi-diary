import { describe, expect, it } from "vitest";
import { breadcrumbLd, clampDescription, pageTitle, serializeLd } from "../lib/seo";
import { searchAll } from "../lib/search";
import { menu, store } from "./fixtures";

describe("seo", () => {
  it("always marks the site as unofficial in titles", () => {
    expect(pageTitle("メニュー図鑑")).toBe("メニュー図鑑｜CHAGEE日本語ガイド（非公式）");
    expect(pageTitle("")).toContain("（非公式）");
  });

  it("clamps long descriptions", () => {
    expect(clampDescription("あ".repeat(200))).toHaveLength(120);
  });

  it("builds absolute breadcrumb URLs and escapes JSON-LD", () => {
    const ld = breadcrumbLd([{ name: "メニュー図鑑", href: "/menu" }]);
    expect(JSON.stringify(ld)).toContain("https://chagee.tomokichidiary.com/menu");
    expect(serializeLd({ a: "</script>" })).not.toContain("</script>");
  });
});

describe("searchAll", () => {
  it("requires every term to match", () => {
    const data = { menus: [menu()], stores: [store()], news: [], columns: [] };
    expect(searchAll("上海 豫園", data).stores).toHaveLength(1);
    expect(searchAll("上海 空港", data).total).toBe(0);
    expect(searchAll("  ", data).total).toBe(0);
  });
});
