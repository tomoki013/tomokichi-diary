import { describe, expect, it } from "vitest";
import type { ExperienceTag } from "@tomokichi/domain";
import {
  DISCOVERY_PICKS,
  byTravelDate,
  discoverySummary,
  latLonLabel,
  recommend,
  sceneBackdrop,
  timeSince,
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

describe("timeSince", () => {
  it("reads like someone remembering a trip", () => {
    expect(timeSince("2026-11-01", "2026-11-15")).toBe("今月");
    expect(timeSince("2026-03-08", "2026-11-15")).toBe("8か月前");
    expect(timeSince("2024-10-01", "2026-11-15")).toBe("2年前");
    expect(timeSince("2024-03-01", "2026-11-15")).toBe("2年半前");
  });

  it("says nothing for an unknown or future date", () => {
    expect(timeSince(null, "2026-11-15")).toBeNull();
    expect(timeSince("2027-01-01", "2026-11-15")).toBeNull();
  });
});

describe("latLonLabel", () => {
  it("writes the place as a field note would", () => {
    expect(latLonLabel([31.63, 22.34])).toBe("北緯22.3° 東経31.6°");
    expect(latLonLabel([-3.7, -40.42])).toBe("南緯40.4° 西経3.7°");
  });
});

describe("byTravelDate", () => {
  it("puts the oldest trip first and undated ones last", () => {
    const items = [
      { travelDate: "2025-01-01", id: "b" },
      { travelDate: null, id: "x" },
      { travelDate: "2023-05-01", id: "a" },
    ];
    expect(byTravelDate(items).map((item) => item.id)).toEqual(["a", "b", "x"]);
  });
});

const photo = (storageKey: string) => ({ cover: { storageKey, alt: "" } });

describe("sceneBackdrop", () => {
  it("takes the last cover, or the first for glow", () => {
    const items = [photo("first"), { cover: null }, photo("last"), { cover: null }];
    expect(sceneBackdrop("spotlight", items)?.storageKey).toBe("last");
    expect(sceneBackdrop("glow", items)?.storageKey).toBe("first");
  });
});
