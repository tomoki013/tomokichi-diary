import { describe, expect, it } from "vitest";
import type { ExperienceTag } from "@tomokichi/domain";
import {
  DISCOVERY_PICKS,
  discoverySummary,
  recommend,
  type DiscoveryCandidate,
} from "../lib/home-discovery";

const article = (slug: string, tags: ExperienceTag[], cover = true): DiscoveryCandidate => ({
  article: { id: slug, slug, experienceTags: tags },
  cover: cover ? {} : null,
});

describe("DISCOVERY_PICKS", () => {
  it("never picks the same story for two feelings", () => {
    const all = Object.values(DISCOVERY_PICKS).flat();
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("recommend", () => {
  it("leaves another feeling's pick for last when filling in", () => {
    // egypt4 is the pick for これは終わった…; under ハラハラ it should come after
    // a story nobody picked, even though it is newer.
    const candidates = [
      article("egypt4", ["thrilling", "disaster"]),
      article("unpicked", ["thrilling"]),
    ];
    const slugs = recommend(candidates, "thrilling").map((c) => c.article.slug);
    expect(slugs.indexOf("unpicked")).toBeLessThan(slugs.indexOf("egypt4"));
  });

  it("keeps the incoming order for scene photos", () => {
    const candidates = [
      article("egypt4", ["thrilling", "disaster"]),
      article("unpicked", ["thrilling"]),
    ];
    const slugs = recommend(candidates, "thrilling", { prioritizePicks: false }).map(
      (c) => c.article.slug,
    );
    expect(slugs).toEqual(["egypt4", "unpicked"]);
  });
});

describe("discoverySummary", () => {
  it("drops a leading series marker", () => {
    expect(discoverySummary("【周遊旅行記 第10回】エジプト旅行最大のトラブル。")).toBe(
      "エジプト旅行最大のトラブル。",
    );
  });

  it("leaves other summaries and later brackets alone", () => {
    expect(discoverySummary("夕日を見に行った。【追記】あり")).toBe(
      "夕日を見に行った。【追記】あり",
    );
  });
});
