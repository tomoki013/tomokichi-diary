import { describe, expect, it } from "vitest";
import { pickHeroPhotos, rankGallery, scorePhoto, type GalleryCandidate } from "../lib/gallery";

const photo = (overrides: Partial<GalleryCandidate> = {}): GalleryCandidate => ({
  key: "images/a.jpg",
  articleId: "a",
  role: "inline",
  alt: "",
  mimeType: "image/jpeg",
  width: 1400,
  height: 1000,
  tags: [],
  ...overrides,
});

describe("scorePhoto", () => {
  it("puts a view ahead of an airport lounge", () => {
    expect(scorePhoto(photo({ alt: "イアの夕日" }))).toBeGreaterThan(
      scorePhoto(photo({ alt: "空港ラウンジの会員特典" })),
    );
  });

  it("does not read 空港 as the scenic 港", () => {
    expect(scorePhoto(photo({ alt: "チャンギ空港" }))).toBeLessThan(0);
  });

  it("marks down screenshots and frames pulled from phone video", () => {
    expect(scorePhoto(photo({ mimeType: "image/png" }))).toBeLessThan(scorePhoto(photo()));
    expect(scorePhoto(photo({ width: 450, height: 970 }))).toBeLessThan(scorePhoto(photo()));
  });

  it("follows the article's tags", () => {
    expect(scorePhoto(photo({ tags: ["空港アクセス"] }))).toBeLessThan(scorePhoto(photo()));
    expect(scorePhoto(photo({ tags: ["観光スポット"] }))).toBeGreaterThan(scorePhoto(photo()));
  });
});

describe("rankGallery", () => {
  it("orders by score and keeps ties in their original order", () => {
    const ranked = rankGallery([
      photo({ key: "lounge", articleId: "1", alt: "空港ラウンジ" }),
      photo({ key: "plain-1", articleId: "2" }),
      photo({ key: "sunset", articleId: "3", alt: "夕日" }),
      photo({ key: "plain-2", articleId: "4" }),
    ]);
    expect(ranked.map((item) => item.key)).toEqual(["sunset", "plain-1", "plain-2", "lounge"]);
  });

  it("does not let one article fill consecutive places when others are left", () => {
    const ranked = rankGallery([
      photo({ key: "a1", articleId: "a", alt: "夕日" }),
      photo({ key: "a2", articleId: "a", alt: "夕日" }),
      photo({ key: "a3", articleId: "a", alt: "夕日" }),
      photo({ key: "b1", articleId: "b" }),
      photo({ key: "c1", articleId: "c" }),
    ]);
    expect(ranked.map((item) => item.key)).toEqual(["a1", "b1", "c1", "a2", "a3"]);
  });
});

describe("pickHeroPhotos", () => {
  it("takes wide, well-scored photographs, one per article, up to the count", () => {
    const picks = pickHeroPhotos(
      [
        photo({ key: "tall", articleId: "1", alt: "夕日", width: 1000, height: 1600 }),
        photo({ key: "small", articleId: "2", alt: "夕日", width: 800, height: 500 }),
        photo({ key: "lounge", articleId: "3", alt: "空港ラウンジ" }),
        photo({ key: "wide-1", articleId: "4", alt: "夕日" }),
        photo({ key: "wide-2", articleId: "4", alt: "夜景" }),
        photo({ key: "wide-3", articleId: "5", alt: "宮殿" }),
        photo({ key: "wide-4", articleId: "6", alt: "神殿" }),
      ],
      2,
    );
    expect(picks.map((item) => item.key)).toEqual(["wide-1", "wide-3"]);
  });
});
