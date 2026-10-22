import { describe, expect, it } from "vitest";
import type { MediaAsset } from "@tomokichi/domain";
import { canonicalImageLinks } from "../use-cases/content/media-links.js";

const asset = (id: string, slug: string | null, mimeType = "image/jpeg"): MediaAsset =>
  ({
    id,
    slug,
    mimeType,
    storageKey: `originals/ab/${id}.${mimeType === "image/png" ? "png" : "jpg"}`,
  }) as MediaAsset;

const media = [asset("m1", "eiffel-tower"), asset("m2", "louvre", "image/png")];

describe("canonicalImageLinks", () => {
  it("rewrites a slug URL to the library path", () => {
    expect(
      canonicalImageLinks(
        "![塔](https://api.tomokichidiary.com/v1/images/eiffel-tower.jpg)\n本文",
        media,
      ),
    ).toBe("![塔](/originals/ab/m1.jpg)\n本文");
  });

  it("follows an old slug through its alias", () => {
    expect(
      canonicalImageLinks("![](https://api.example/v1/images/old-name.png)", media, [
        { slug: "old-name", mediaId: "m2" },
      ]),
    ).toBe("![](/originals/ab/m2.png)");
  });

  it("leaves unknown slugs and mismatched types for the link check", () => {
    const body =
      "![](https://api.tomokichidiary.com/v1/images/nowhere.jpg) ![](https://api.tomokichidiary.com/v1/images/louvre.jpg)";
    expect(canonicalImageLinks(body, media)).toBe(body);
  });

  it("does not touch library paths or other links", () => {
    const body = "![](/images/Paris/a.jpg) [api](https://api.tomokichidiary.com/v1/articles)";
    expect(canonicalImageLinks(body, media)).toBe(body);
  });
});
