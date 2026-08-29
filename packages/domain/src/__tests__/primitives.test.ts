import { describe, expect, it } from "vitest";
import { generateId, isId } from "../primitives/id.js";
import { parseSlug, slugify } from "../primitives/slug.js";
import { parseLocale } from "../primitives/locale.js";
import {
  compareInstants,
  instantFrom,
  parseInstant,
  parsePlainDate,
  toPlainDate,
} from "../primitives/datetime.js";
import {
  extractEmbedAnchors,
  extractHeadings,
  extractImages,
  extractInternalLinks,
  toPlainText,
  truncate,
  validateHeadingStructure,
} from "../rules/markdown.js";

describe("generateId", () => {
  it("produces a valid, version 7, time-ordered identifier", () => {
    const early = generateId(1_700_000_000_000);
    const late = generateId(1_800_000_000_000);
    expect(isId(early)).toBe(true);
    expect(early[14]).toBe("7");
    expect(early < late).toBe(true);
  });

  it("does not collide across a batch", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateId()));
    expect(ids.size).toBe(1000);
  });
});

describe("parseSlug", () => {
  it.each(["chagee-menu-explained", "a", "a1-b2"])("accepts %s", (value) => {
    expect(parseSlug(value).ok).toBe(true);
  });

  it.each([
    "",
    "  ",
    "-leading",
    "trailing-",
    "double--hyphen",
    "Upper Case With Spaces",
    "日本語",
  ])("rejects %s", (value) => {
    expect(parseSlug(value).ok).toBe(false);
  });

  it("normalises case and surrounding whitespace", () => {
    const result = parseSlug("  Chagee-Menu  ");
    expect(result.ok && result.value).toBe("chagee-menu");
  });
});

describe("slugify", () => {
  it("builds a usable slug from latin text and gives up on non-latin scripts", () => {
    expect(slugify("CHAGEE Menu — Explained!")).toBe("chagee-menu-explained");
    expect(slugify("上海のCHAGEE")).toBe("chagee");
  });
});

describe("locale and dates", () => {
  it("accepts only supported locales", () => {
    expect(parseLocale("ja").ok).toBe(true);
    expect(parseLocale("fr").ok).toBe(false);
  });

  it("parses and compares instants", () => {
    expect(parseInstant("nope").ok).toBe(false);
    expect(parseInstant("2026-08-24").ok).toBe(true);
    expect(compareInstants(instantFrom("2026-01-01"), instantFrom("2026-02-01"))).toBe(-1);
    expect(toPlainDate(instantFrom("2026-08-24T15:00:00Z"))).toBe("2026-08-24");
  });

  it("rejects malformed plain dates", () => {
    expect(parsePlainDate("2026-8-4").ok).toBe(false);
    expect(parsePlainDate("2026-13-01").ok).toBe(false);
    expect(parsePlainDate("2026-08-24").ok).toBe(true);
  });
});

describe("markdown structure", () => {
  const body = [
    "本文の導入です。",
    "",
    "## 見出し2",
    "",
    "![上海のCHAGEE](/images/China/chagee.jpg)",
    "",
    "[関連記事](/posts/chagee-singapore-stores) と [外部](https://example.com)。",
    "",
    "{{embed:shanghai-map}}",
    "",
    "```",
    "{{embed:ignored-in-code}}",
    "```",
  ].join("\n");

  it("extracts embeds, ignoring fenced code", () => {
    expect(extractEmbedAnchors(body)).toEqual(["shanghai-map"]);
  });

  it("extracts headings, internal links and images separately", () => {
    expect(extractHeadings(body)).toEqual([{ level: 2, text: "見出し2" }]);
    expect(extractInternalLinks(body)).toEqual(["/posts/chagee-singapore-stores"]);
    expect(extractImages(body)).toEqual([{ alt: "上海のCHAGEE", src: "/images/China/chagee.jpg" }]);
  });

  it("flags an h1 in the body and a skipped heading level", () => {
    expect(validateHeadingStructure("# 題名")).toHaveLength(1);
    expect(validateHeadingStructure("## a\n#### b")).toHaveLength(1);
    expect(validateHeadingStructure("## a\n### b\n## c")).toEqual([]);
  });

  it("reduces a body to plain text for descriptions", () => {
    const text = toPlainText(body);
    expect(text.startsWith("本文の導入です。")).toBe(true);
    expect(text).not.toContain("![");
    expect(text).not.toContain("{{embed");
    expect(text).toContain("関連記事");
  });

  it("truncates on a sentence boundary when one is close to the limit", () => {
    expect(truncate("短い", 100)).toBe("短い");
    expect(truncate("一文目です。二文目です。三文目はとても長い", 15)).toBe(
      "一文目です。二文目です。…",
    );
  });

  it("falls back to a hard cut rather than losing most of the text", () => {
    expect(truncate("一文目です。二文目はとても長くて切られます。", 15)).toBe(
      "一文目です。二文目はとても長く…",
    );
  });
});
