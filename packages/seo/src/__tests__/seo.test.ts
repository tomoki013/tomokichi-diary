import { describe, expect, it } from "vitest";
import type { Article, ArticleRevision, Place, Route } from "@tomokichi/domain";
import { DEFAULT_SEO_CONFIG } from "../config.js";
import {
  buildArticleMetadata,
  buildHreflang,
  buildPageMetadata,
  buildRobots,
  buildTitle,
} from "../metadata.js";
import {
  buildArticleJsonLd,
  buildBreadcrumbJsonLd,
  buildPlaceJsonLd,
  serializeJsonLd,
} from "../structured-data.js";
import { buildSitemap, renderRobotsTxt, renderRssXml, renderSitemapXml } from "../feeds.js";

const config = DEFAULT_SEO_CONFIG;

const route = {
  id: "route-1",
  path: "/posts/chagee-menu-explained",
  locale: "ja",
  targetType: "article",
  targetId: "article-1",
  isCanonical: true,
  redirectTo: null,
  redirectStatus: null,
  isLegacy: true,
} as unknown as Route;

const article = {
  id: "article-1",
  status: "published",
  locale: "ja",
  slug: "chagee-menu-explained",
  authorId: "author-1",
  currentRevisionId: "rev-1",
  publishedRevisionId: "rev-1",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-25T00:00:00.000Z",
  scheduledAt: null,
  publishedAt: "2026-08-24T00:00:00.000Z",
  archivedAt: null,
  noindex: false,
} as unknown as Article;

const revision = {
  id: "rev-1",
  articleId: "article-1",
  revisionNumber: 1,
  title: "CHAGEEのメニューを日本語で解説",
  summary: "代表的な4メニューを日本語で解説します。",
  bodyMarkdown: "## 見出し\n\n本文です。",
  seoTitleOverride: null,
  seoDescriptionOverride: null,
  changeSummary: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  createdBy: "author-1",
} as unknown as ArticleRevision;

describe("titles and descriptions", () => {
  it("appends the site name and honours an override", () => {
    expect(buildTitle(config, "記事")).toBe(`記事${config.titleSeparator}${config.siteName}`);
    expect(buildTitle(config, "記事", "上書き")).toBe(
      `上書き${config.titleSeparator}${config.siteName}`,
    );
    expect(buildTitle(config, config.siteName)).toBe(config.homeTitle);
    expect(buildTitle({ ...config, homeTitle: undefined }, config.siteName)).toBe(config.siteName);
  });

  it("derives a description from the summary, falling back to the body", () => {
    expect(
      buildArticleMetadata(config, {
        article,
        revision,
        route,
        coverImageUrl: null,
        authorName: null,
      }).description,
    ).toBe(revision.summary);
    const noSummary = { ...revision, summary: "  " } as ArticleRevision;
    expect(
      buildArticleMetadata(config, {
        article,
        revision: noSummary,
        route,
        coverImageUrl: null,
        authorName: null,
      }).description,
    ).toBe("見出し 本文です。");
  });

  it("prefers an explicit SEO description override", () => {
    const overridden = {
      ...revision,
      seoDescriptionOverride: "上書きされた説明",
    } as ArticleRevision;
    expect(
      buildArticleMetadata(config, {
        article,
        revision: overridden,
        route,
        coverImageUrl: null,
        authorName: null,
      }).description,
    ).toBe("上書きされた説明");
  });
});

describe("buildPageMetadata", () => {
  it("describes a non-article page as a website and can mark it noindex", () => {
    const meta = buildPageMetadata(config, {
      title: "上海の記事一覧",
      description: "上海に関する記事をまとめています。",
      route: { ...route, path: "/destination/shanghai" } as Route,
      noindex: true,
    });
    expect(meta.canonical).toBe("https://tomokichidiary.com/destination/shanghai");
    expect(meta.openGraph["og:type"]).toBe("website");
    expect(meta.robots).toBe("noindex, nofollow");
  });
});

describe("canonical and robots", () => {
  it("builds an absolute canonical URL from the route, not from the slug", () => {
    const meta = buildArticleMetadata(config, {
      article,
      revision,
      route,
      coverImageUrl: null,
      authorName: null,
    });
    expect(meta.canonical).toBe("https://tomokichidiary.com/posts/chagee-menu-explained");
  });

  it("marks noindex articles and non-indexable environments", () => {
    expect(buildRobots(config, false)).toBe("index, follow");
    expect(buildRobots(config, true)).toBe("noindex, nofollow");
    expect(buildRobots({ ...config, indexable: false }, false)).toBe("noindex, nofollow");
  });
});

describe("open graph", () => {
  it("uses a large image card only when a cover exists", () => {
    const withImage = buildArticleMetadata(config, {
      article,
      revision,
      route,
      coverImageUrl: "https://cdn.example.com/cover.jpg",
      authorName: "ともきち",
    });
    expect(withImage.openGraph["og:image"]).toBe("https://cdn.example.com/cover.jpg");
    expect(withImage.twitter["twitter:card"]).toBe("summary_large_image");
    expect(withImage.openGraph["article:published_time"]).toBe(article.publishedAt);

    const withoutImage = buildArticleMetadata(config, {
      article,
      revision,
      route,
      coverImageUrl: null,
      authorName: null,
    });
    expect(withoutImage.twitter["twitter:card"]).toBe("summary");
    expect(withoutImage.openGraph["og:image"]).toBeUndefined();
  });
});

describe("hreflang", () => {
  it("is empty for a single-locale page and includes x-default otherwise", () => {
    expect(buildHreflang(config, [route])).toEqual([]);
    const en = { ...route, locale: "en", path: "/en/posts/chagee-menu-explained" } as Route;
    const links = buildHreflang(config, [route, en]);
    expect(links.map((l) => l.hreflang)).toEqual(["ja", "en", "x-default"]);
    expect(links.at(-1)?.href).toBe("https://tomokichidiary.com/posts/chagee-menu-explained");
  });
});

describe("JSON-LD", () => {
  const place = {
    id: "place-1",
    slug: "chagee-shanghai",
    locationId: "loc-shanghai",
    kind: "cafe",
    name: "CHAGEE 上海店",
    address: "上海市黄浦区",
    latitude: 31.23,
    longitude: 121.47,
    officialUrl: "https://example.com",
    status: "open",
  } as unknown as Place;

  it("builds an Article node from entities", () => {
    const jsonLd = buildArticleJsonLd(config, {
      article,
      revision,
      route,
      description: "説明",
      coverImageUrl: "https://cdn.example.com/cover.jpg",
      author: { name: "ともきち", url: null },
      about: [place],
    });
    expect(jsonLd["@type"]).toBe("Article");
    expect(jsonLd["datePublished"]).toBe(article.publishedAt);
    expect(jsonLd["dateModified"]).toBe(article.updatedAt);
    expect(jsonLd["url"]).toBe("https://tomokichidiary.com/posts/chagee-menu-explained");
    expect((jsonLd["about"] as unknown[])[0]).toMatchObject({
      "@type": "CafeOrCoffeeShop",
      name: "CHAGEE 上海店",
    });
  });

  it("maps place kinds to schema.org types and includes coordinates", () => {
    const jsonLd = buildPlaceJsonLd(config, place, route);
    expect(jsonLd["@type"]).toBe("CafeOrCoffeeShop");
    expect(jsonLd["geo"]).toMatchObject({ latitude: 31.23, longitude: 121.47 });
  });

  it("omits a breadcrumb with fewer than two levels", () => {
    expect(buildBreadcrumbJsonLd(config, [{ name: "ホーム", route }])).toBeNull();
    const trail = buildBreadcrumbJsonLd(config, [
      { name: "ホーム", route: { ...route, path: "/" } as Route },
      { name: "記事", route },
    ]);
    const items = (trail?.["itemListElement"] ?? []) as { position: number }[];
    expect(items[1]?.position).toBe(2);
  });

  it("escapes angle brackets so a script tag cannot break out", () => {
    expect(serializeJsonLd({ name: "</script>" })).not.toContain("</script>");
    expect(serializeJsonLd(null)).toBe("");
  });
});

describe("sitemap, rss and robots", () => {
  const inputs = [
    { route, lastmod: "2026-08-25T00:00:00.000Z", indexable: true },
    { route: { ...route, path: "/posts/hidden" } as Route, lastmod: null, indexable: false },
    {
      route: { ...route, path: "/old", targetType: "redirect", isCanonical: false } as Route,
      lastmod: null,
      indexable: true,
    },
    {
      route: { ...route, path: "/alt", isCanonical: false } as Route,
      lastmod: null,
      indexable: true,
    },
  ];

  it("drops routes the table itself marks noindex", () => {
    const entries = buildSitemap(config, [
      {
        route: { ...route, path: "/destination/thin", noindex: true } as Route,
        lastmod: null,
        indexable: true,
      },
    ]);
    expect(entries).toEqual([]);
  });

  it("includes only indexable canonical non-redirect routes", () => {
    const entries = buildSitemap(config, inputs);
    expect(entries.map((e) => e.loc)).toEqual([
      "https://tomokichidiary.com/posts/chagee-menu-explained",
    ]);
  });

  it("renders valid-looking XML", () => {
    const xml = renderSitemapXml(buildSitemap(config, inputs));
    expect(xml).toContain("<urlset");
    expect(xml).toContain("<loc>https://tomokichidiary.com/posts/chagee-menu-explained</loc>");
  });

  it("escapes XML in feed titles", () => {
    const rss = renderRssXml(config, [
      { title: "A & B <tag>", description: "説明", route, publishedAt: "2026-08-24T00:00:00.000Z" },
    ]);
    expect(rss).toContain("A &amp; B &lt;tag&gt;");
    expect(rss).toContain("Mon, 24 Aug 2026");
  });

  it("blocks everything when the environment is not indexable", () => {
    expect(renderRobotsTxt({ ...config, indexable: false })).toBe("User-agent: *\nDisallow: /\n");
    const robots = renderRobotsTxt(config, { disallow: ["/preview/"] });
    expect(robots).toContain("Disallow: /preview/");
    expect(robots).toContain("Sitemap: https://tomokichidiary.com/sitemap.xml");
  });
});
