import { describe, expect, it } from "vitest";
import { imageUrlProblem, jsonLdImageUrls, readSeo } from "../page-seo.js";

/*
 * Why this exists: every article shipped `og:image` as
 * `https://tomokichidiary.com/https://media.tomokichidiary.com/…` — a media
 * URL made absolute twice — and no check noticed because the value was a
 * syntactically valid URL. These tests pin the rule that `check:seo` now
 * applies to the built HTML, so the composition cannot regress silently.
 */

const page = `<!doctype html><html><head>
<title>CHAGEE｜ともきちの旅行日記</title>
<meta name="description" content="実体験ベース">
<link rel="canonical" href="https://tomokichidiary.com/posts/shanghai-chagee">
<meta property="og:image" content="https://media.tomokichidiary.com/images/China/chagee.jpg">
<meta name="twitter:image" content="https://media.tomokichidiary.com/images/China/chagee.jpg">
<script type="application/ld+json">{"@type":"Article","image":["https://media.tomokichidiary.com/images/China/chagee.jpg"]}</script>
<script type="application/ld+json">{"@type":"BreadcrumbList"}</script>
</head><body><h1>CHAGEE</h1><img src="/a.jpg" alt=""><img src="/b.jpg"></body></html>`;

describe("readSeo", () => {
  it("collects og:image and twitter:image alongside the existing fields", () => {
    const seo = readSeo(page);
    expect(seo.title).toBe("CHAGEE｜ともきちの旅行日記");
    expect(seo.canonical).toBe("https://tomokichidiary.com/posts/shanghai-chagee");
    expect(seo.h1Count).toBe(1);
    expect(seo.imagesWithoutAlt).toBe(1);
    expect(seo.socialImages).toEqual([
      "https://media.tomokichidiary.com/images/China/chagee.jpg",
      "https://media.tomokichidiary.com/images/China/chagee.jpg",
    ]);
    expect(seo.jsonLd).toHaveLength(2);
  });

  it("reports no social images on a page that declares none", () => {
    expect(readSeo("<html><head><title>x</title></head></html>").socialImages).toEqual([]);
  });
});

describe("jsonLdImageUrls", () => {
  it("reads string, array and ImageObject forms and skips unparsable blocks", () => {
    expect(
      jsonLdImageUrls([
        '{"image":"https://m/a.jpg"}',
        '{"image":["https://m/b.jpg",{"@type":"ImageObject","url":"https://m/c.jpg"}]}',
        "{not json",
        '[{"@type":"WebSite"},{"image":"https://m/d.jpg"}]',
      ]),
    ).toEqual(["https://m/a.jpg", "https://m/b.jpg", "https://m/c.jpg", "https://m/d.jpg"]);
  });
});

describe("imageUrlProblem", () => {
  it("accepts one absolute https image URL", () => {
    expect(imageUrlProblem("https://media.tomokichidiary.com/images/China/chagee.jpg")).toBeNull();
    expect(imageUrlProblem("https://media.tomokichidiary.com/x/y.avif?v=2")).toBeNull();
  });

  it("rejects the double-prefixed URL that shipped", () => {
    expect(
      imageUrlProblem(
        "https://tomokichidiary.com/https://media.tomokichidiary.com/images/China/chagee.jpg",
      ),
    ).toMatch(/nested URL/);
    expect(imageUrlProblem("https://a.example/https%3A%2F%2Fb.example/c.jpg")).toMatch(/nested/);
  });

  it("rejects relative paths, other schemes and non-image targets", () => {
    expect(imageUrlProblem("/images/China/chagee.jpg")).toMatch(/absolute/);
    expect(imageUrlProblem("data:image/png;base64,AAAA")).toMatch(/scheme/);
    expect(imageUrlProblem("https://media.tomokichidiary.com/posts/chagee")).toMatch(/extension/);
  });
});
