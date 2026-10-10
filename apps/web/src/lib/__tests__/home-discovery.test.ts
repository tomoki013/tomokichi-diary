import { describe, expect, it } from "vitest";
import { EXPERIENCE_TAGS, type ExperienceTag } from "@tomokichi/domain";
import {
  DISCOVERY_TEMPLATES,
  TEMPLATES,
  defaultExperience,
  explorerFacts,
  parseHomeExperience,
  placeLabel,
  recommend,
  templateFor,
  travelMonthOf,
} from "../home-discovery";

const article = (slug: string, experienceTags: ExperienceTag[], cover = true) => ({
  article: { id: `id-${slug}`, slug, experienceTags },
  cover: cover ? { storageKey: `${slug}.jpg` } : null,
});

const slugs = (list: { article: { slug: string } }[]) => list.map((view) => view.article.slug);

describe("template resolution", () => {
  it("maps every experience tag to one of the three templates", () => {
    for (const tag of EXPERIENCE_TAGS) {
      expect(Object.keys(TEMPLATES)).toContain(DISCOVERY_TEMPLATES[tag]);
      expect(templateFor(tag).id).toBe(DISCOVERY_TEMPLATES[tag]);
    }
  });

  it("follows the agreed grouping", () => {
    expect(templateFor("moving").id).toBe("visual");
    expect(templateFor("unforgettable").id).toBe("album");
    expect(templateFor("thrilling").id).toBe("story");
    expect(templateFor("challenge").id).toBe("story");
    expect(templateFor("disaster").id).toBe("casefile");
    expect(templateFor("funny").id).toBe("manga");
    expect(templateFor("exciting").id).toBe("ticket");
    expect(templateFor("discovery").id).toBe("explorer");
  });

  it("gives every template a short label for the mood tiles", () => {
    for (const template of Object.values(TEMPLATES)) {
      expect(template.short.length).toBeGreaterThan(0);
      expect(template.short.length).toBeLessThanOrEqual(4);
    }
  });
});

describe("parseHomeExperience", () => {
  it("accepts a tag verbatim", () => {
    expect(parseHomeExperience("funny")).toBe("funny");
  });

  it.each([null, undefined, "", "Funny", " funny", "funny,moving", "<script>", "__proto__"])(
    "rejects %j",
    (value) => {
      expect(parseHomeExperience(value)).toBeNull();
    },
  );
});

describe("defaultExperience", () => {
  it("prefers the photo layout", () => {
    expect(defaultExperience({ exciting: 3, moving: 2 })).toBe("moving");
  });

  it("falls back in vocabulary order when the preferred tag is empty", () => {
    expect(defaultExperience({ moving: 0, thrilling: 1, discovery: 4 })).toBe("thrilling");
  });

  it("returns nothing when no tag has a story", () => {
    expect(defaultExperience({})).toBeNull();
  });
});

describe("recommend", () => {
  const views = [
    article("newest", ["thrilling", "moving"], false),
    article("second", ["moving"]),
    article("third", ["funny"]),
    article("fourth", ["moving"]),
    article("fifth", ["moving"]),
    article("sixth", ["moving"]),
  ];

  it("keeps only articles carrying the tag, newest first, up to four", () => {
    expect(slugs(recommend(views, "thrilling"))).toEqual(["newest"]);
    expect(recommend(views, "moving")).toHaveLength(4);
  });

  it("puts covers first for photo layouts and keeps a photo-less one as a fallback", () => {
    expect(slugs(recommend(views, "moving"))).toEqual(["second", "fourth", "fifth", "sixth"]);
    expect(slugs(recommend(views, "moving", { limit: 10 })).at(-1)).toBe("newest");
  });

  it("ignores covers for text-led layouts", () => {
    const story = [article("a", ["thrilling"], false), article("b", ["thrilling"])];
    expect(slugs(recommend(story, "thrilling"))).toEqual(["a", "b"]);
  });

  it("moves articles already featured on the page to the end", () => {
    const result = recommend(views, "moving", {
      limit: 10,
      shownElsewhere: new Set(["id-second"]),
    });
    expect(slugs(result)).toEqual(["fourth", "fifth", "sixth", "second", "newest"]);
  });

  it("drops duplicates", () => {
    const twice = [article("same", ["funny"]), article("same", ["funny"])];
    expect(recommend(twice, "funny")).toHaveLength(1);
  });

  it("is deterministic regardless of call order", () => {
    const first = slugs(recommend(views, "moving"));
    recommend(views.toReversed(), "moving");
    expect(slugs(recommend(views, "moving"))).toEqual(first);
  });

  it("returns an empty list when nothing matches or the limit is zero", () => {
    expect(recommend(views, "disaster")).toEqual([]);
    expect(recommend([], "moving")).toEqual([]);
    expect(recommend(views, "moving", { limit: 0 })).toEqual([]);
  });
});

describe("explorerFacts", () => {
  it("lists only the rows the data supports, in a fixed order", () => {
    expect(
      explorerFacts({ place: "カイロ / エジプト", travelMonth: "2024.03", categories: ["旅行記"] }),
    ).toEqual([
      { label: "地域", value: "カイロ / エジプト" },
      { label: "旅の時期", value: "2024.03" },
      { label: "テーマ", value: "旅行記" },
    ]);
    expect(explorerFacts({ place: null, travelMonth: null, categories: [] })).toEqual([]);
  });
});

describe("formatting helpers", () => {
  it("formats the travel month and rejects malformed dates", () => {
    expect(travelMonthOf("2024-03-08")).toBe("2024.03");
    expect(travelMonthOf("2024-03")).toBe("2024.03");
    expect(travelMonthOf("March 2024")).toBeNull();
    expect(travelMonthOf(null)).toBeNull();
  });

  it("joins the place with its country only when they differ", () => {
    expect(placeLabel("カッパドキア", "トルコ")).toBe("カッパドキア / トルコ");
    expect(placeLabel("トルコ", "トルコ")).toBe("トルコ");
    expect(placeLabel(null, "トルコ")).toBe("トルコ");
    expect(placeLabel(null, null)).toBeNull();
  });
});
