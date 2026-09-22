import { RouteTable, type Route } from "@tomokichi/domain";
import type { ContentSnapshot } from "@tomokichi/data";
import { describe, expect, it } from "vitest";
import type { LegacyPost } from "../../lib/legacy-source.js";
import { compareArticles } from "../compare.js";
import {
  buildLegacyPosts,
  legacyPathFor,
  mergeFrontmatter,
  toLegacyBody,
  yamlScalar,
} from "../export-legacy.js";
import { normalizeBody, normalizeLegacyPosts, normalizeSnapshot } from "../normalized-article.js";

const ARTICLE = "a1";
const REVISION = "r1";
const AUTHOR = "au";

function route(path: string, overrides: Partial<Record<keyof Route, unknown>> = {}): Route {
  return {
    id: `route:${path}`,
    path,
    locale: "ja",
    targetType: "static",
    targetId: null,
    isCanonical: true,
    redirectTo: null,
    redirectStatus: null,
    isLegacy: true,
    noindex: false,
    ...overrides,
  } as Route;
}

const ROUTES: Route[] = [
  route("/posts/sample", { targetType: "article", targetId: ARTICLE }),
  route("/posts/other", { targetType: "article", targetId: "a2" }),
  route("/collections", { isLegacy: false }),
  route("/series", {
    targetType: "redirect",
    isCanonical: false,
    redirectTo: "/collections",
    redirectStatus: 301,
  }),
  route("/journey", {
    targetType: "redirect",
    isCanonical: false,
    redirectTo: "/collections",
    redirectStatus: 301,
  }),
  route("/legal/privacy", { isLegacy: false }),
  route("/privacy", {
    targetType: "redirect",
    isCanonical: false,
    redirectTo: "/legal/privacy",
    redirectStatus: 301,
  }),
];

const BODY = [
  "{{embed:promotion-disclosure}}",
  "",
  "導入です。",
  "",
  "## 見出し",
  "",
  "![写真](/images/Test/one.jpg)",
  "",
  "[別記事](./other) と [一覧](/collections) と [規約](/legal/privacy)",
  "",
  "| a | b |",
  "| --- | ---: |",
  "| 1 | 2 |",
].join("\n");

function snapshot(overrides: Partial<ContentSnapshot> = {}): ContentSnapshot {
  return {
    generatedAt: "2026-09-22T00:00:00.000Z",
    articles: [
      {
        id: ARTICLE,
        kind: "article",
        status: "published",
        locale: "ja",
        slug: "sample",
        authorId: AUTHOR,
        currentRevisionId: REVISION,
        publishedRevisionId: REVISION,
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-09-22T00:00:00.000Z",
        scheduledAt: null,
        publishedAt: "2026-03-01T00:00:00.000Z",
        archivedAt: null,
        noindex: false,
        travelStartDate: "2026-02-10",
        travelEndDate: null,
      },
    ],
    revisions: [
      {
        id: REVISION,
        articleId: ARTICLE,
        revisionNumber: 2,
        title: "サンプル記事｜テスト",
        summary: "要約です。",
        bodyMarkdown: BODY,
        seoTitleOverride: null,
        seoDescriptionOverride: "説明文です。",
        changeSummary: null,
        createdAt: "2026-09-22T00:00:00.000Z",
        createdBy: AUTHOR,
      },
    ],
    embeds: [],
    routes: ROUTES,
    locations: [{ id: "loc", slug: "tokyo", type: "city", parentId: null }],
    locationNames: [],
    places: [],
    categories: [{ id: "cat", slug: "tourism", name: "観光情報", description: null, sortOrder: 0 }],
    tags: [{ id: "tag", slug: "kaigai", name: "海外旅行" }],
    collections: [
      {
        id: "col",
        slug: "chagee",
        kind: "series",
        title: "CHAGEE",
        description: "",
        coverMediaId: null,
        startDate: null,
        endDate: null,
        sortOrder: 0,
      },
    ],
    authors: [{ id: AUTHOR, name: "ともきち", url: null, bio: null }],
    media: [{ id: "m1", storageKey: "images/Test/cover.jpg" }],
    articleMedia: [
      {
        articleId: ARTICLE,
        mediaId: "m1",
        role: "cover",
        sortOrder: 0,
        alt: "cover",
        caption: null,
      },
    ],
    articleLocations: [{ articleId: ARTICLE, locationId: "loc", relation: "primary" }],
    articlePlaces: [],
    articleCategories: [{ articleId: ARTICLE, categoryId: "cat" }],
    articleTags: [{ articleId: ARTICLE, tagId: "tag" }],
    articleCollections: [{ articleId: ARTICLE, collectionId: "col", sortOrder: 0 }],
    aiArtifacts: [],
    sources: [],
    travelRoutes: [],
    travelFacts: [],
    articleKnowledge: [],
    ...overrides,
  } as unknown as ContentSnapshot;
}

const LEGACY_FRONTMATTER = [
  "title: 古いタイトル",
  "excerpt: 古い要約",
  'publishedAt: "2026-03-01"',
  "travelDates:",
  '  start: "2026-02-10"',
  "category: tourism",
  "tags:",
  "  - 海外旅行",
  "heroImage: /images/Test/cover.jpg",
  "regionIds:",
  "  - tokyo",
  "author: ともきち",
  "journeyId: j-2026-02-10",
  "promotionPrograms:",
  "  - trip-com",
].join("\n");

function legacyPost(body: string, frontmatter: Record<string, unknown> = {}): LegacyPost {
  return {
    slug: "sample",
    frontmatter: {
      title: "サンプル記事｜テスト",
      excerpt: "要約です。",
      description: "説明文です。",
      publishedAt: "2026-03-01",
      updatedAt: "2026-09-22",
      category: "tourism",
      tags: ["海外旅行"],
      heroImage: "/images/Test/cover.jpg",
      regionIds: ["tokyo"],
      author: "ともきち",
      ...frontmatter,
    },
    body,
  };
}

/** The legacy file as its author wrote it: same content, legacy conventions. */
const LEGACY_BODY = [
  "導入です。",
  "",
  "## 見出し",
  "",
  "![写真](/images/Test/one.jpg)",
  "",
  "[別記事](./other) と [一覧](/journey) と [規約](/privacy)",
  "",
  "| a    |    b |",
  "| ---- | ---: |",
  "| 1    |    2 |",
].join("\n");

describe("normalizeBody", () => {
  const table = new RouteTable(ROUTES);

  it("removes 2.0-only syntax, follows redirects and ignores table padding", () => {
    expect(normalizeBody(table, BODY)).toBe(normalizeBody(table, LEGACY_BODY));
  });

  it("keeps unknown links so they still count as a difference", () => {
    expect(normalizeBody(table, "[x](/nowhere)")).toBe("[x](/nowhere)");
  });
});

describe("compareArticles", () => {
  it("matches when both sites project to the same NormalizedArticle", () => {
    const entries = compareArticles(
      normalizeSnapshot(snapshot()),
      normalizeLegacyPosts([legacyPost(LEGACY_BODY)], ROUTES),
    );
    expect(entries.map((e) => e.status)).toEqual(["MATCHED"]);
  });

  it("lists every differing field of a conflict", () => {
    const entries = compareArticles(
      normalizeSnapshot(snapshot()),
      normalizeLegacyPosts(
        [
          legacyPost(`${LEGACY_BODY}\n\n古い段落。`, {
            title: "別のタイトル",
            updatedAt: undefined,
          }),
        ],
        ROUTES,
      ),
    );
    expect(entries[0]!.status).toBe("CONFLICT");
    expect(entries[0]!.differences.map((d) => d.field)).toEqual(["title", "updatedAt", "body"]);
  });

  it("reports articles that exist on one side only, keyed by public URL", () => {
    const entries = compareArticles(
      normalizeSnapshot(snapshot()),
      normalizeLegacyPosts([{ ...legacyPost(LEGACY_BODY), slug: "elsewhere" }], ROUTES),
    );
    expect(entries.map((e) => [e.url, e.status])).toEqual([
      ["/posts/elsewhere", "OLD_ONLY"],
      ["/posts/sample", "NEW_ONLY"],
    ]);
  });

  it("ignores pages, drafts and articles outside /posts/", () => {
    const base = snapshot();
    const entries = compareArticles(
      normalizeSnapshot(
        snapshot({
          articles: [
            { ...base.articles[0]!, id: "p" as never, kind: "page", slug: "about" as never },
            { ...base.articles[0]!, status: "draft" },
          ],
        }),
      ),
      [],
    );
    expect(entries).toEqual([]);
  });
});

describe("legacyPathFor / toLegacyBody", () => {
  it("maps tidied 2.0 paths back to the URL the legacy site serves", () => {
    expect(legacyPathFor(ROUTES, "/posts/sample")).toBe("/posts/sample");
    expect(legacyPathFor(ROUTES, "/legal/privacy")).toBe("/privacy");
    expect(legacyPathFor(ROUTES, "/collections")).toBe("/series");
    expect(legacyPathFor(ROUTES, "/nowhere")).toBe("/nowhere");
  });

  it("drops embed anchors and rewrites links", () => {
    expect(toLegacyBody(ROUTES, BODY)).toBe(
      BODY.replace("{{embed:promotion-disclosure}}\n\n", "")
        .replace("/collections", "/series")
        .replace("/legal/privacy", "/privacy"),
    );
  });
});

describe("mergeFrontmatter", () => {
  const owned = {
    title: "新しいタイトル: 副題",
    excerpt: "新しい要約",
    description: "新しい説明",
    updatedAt: "2026-09-22",
    noindex: false,
    heroImage: "/images/Test/cover.jpg",
  };

  it("rewrites only the keys 2.0 owns and keeps everything else verbatim", () => {
    const merged = mergeFrontmatter(LEGACY_FRONTMATTER, owned);
    expect(merged).toBe(
      [
        'title: "新しいタイトル: 副題"',
        "excerpt: 新しい要約",
        "description: 新しい説明",
        'publishedAt: "2026-03-01"',
        'updatedAt: "2026-09-22"',
        "travelDates:",
        '  start: "2026-02-10"',
        "category: tourism",
        "tags:",
        "  - 海外旅行",
        "heroImage: /images/Test/cover.jpg",
        "regionIds:",
        "  - tokyo",
        "author: ともきち",
        "journeyId: j-2026-02-10",
        "promotionPrograms:",
        "  - trip-com",
      ].join("\n"),
    );
  });

  it("removes an owned key whose value went away", () => {
    const withDescription = mergeFrontmatter(LEGACY_FRONTMATTER, owned);
    const without = mergeFrontmatter(withDescription, {
      ...owned,
      description: null,
      updatedAt: null,
    });
    expect(without).not.toContain("description:");
    expect(without).not.toContain("updatedAt:");
    expect(without).toContain("journeyId: j-2026-02-10");
  });

  it("quotes YAML scalars only when the plain form would change meaning", () => {
    expect(yamlScalar("バトゥ洞窟｜行き方")).toBe("バトゥ洞窟｜行き方");
    expect(yamlScalar("Step 1: 乗る")).toBe('"Step 1: 乗る"');
    expect(yamlScalar("[注意] 本文")).toBe('"[注意] 本文"');
    expect(yamlScalar("値 #コメント")).toBe('"値 #コメント"');
  });
});

describe("buildLegacyPosts", () => {
  const existing = `---\n${LEGACY_FRONTMATTER}\n---\n\n${LEGACY_BODY}\n`;

  it("keeps the legacy body verbatim when the content is already equal", () => {
    const [post] = buildLegacyPosts(snapshot(), () => existing);
    expect(post!.contents).toContain("[一覧](/journey)");
    expect(post!.contents).toContain("| a    |    b |");
    expect(post!.contents).toContain("title: サンプル記事｜テスト");
    expect(post!.contents).toContain('updatedAt: "2026-09-22"');
    expect(post!.contents).toContain("journeyId: j-2026-02-10");
    expect(post!.imagePaths).toEqual(["/images/Test/cover.jpg", "/images/Test/one.jpg"]);
  });

  it("is idempotent: exporting its own output again changes nothing", () => {
    const [first] = buildLegacyPosts(snapshot(), () => existing);
    const [second] = buildLegacyPosts(snapshot(), () => first!.contents);
    expect(second!.changed).toBe(false);
    expect(second!.contents).toBe(first!.contents);
  });

  it("writes the 2.0 body (with legacy links) when the content differs", () => {
    const [post] = buildLegacyPosts(snapshot(), () =>
      existing.replace("導入です。", "古い導入です。"),
    );
    expect(post!.changed).toBe(true);
    expect(post!.contents).toContain("導入です。\n");
    expect(post!.contents).not.toContain("古い導入");
    expect(post!.contents).toContain("[一覧](/series)");
    expect(post!.contents).not.toContain("{{embed:");
  });

  it("generates complete frontmatter for an article the legacy site never had", () => {
    const [post] = buildLegacyPosts(snapshot(), () => null);
    expect(post!.contents.split("\n---\n")[0]).toBe(
      [
        "---",
        "title: サンプル記事｜テスト",
        "excerpt: 要約です。",
        "description: 説明文です。",
        'publishedAt: "2026-03-01"',
        'updatedAt: "2026-09-22"',
        "travelDates:",
        '  start: "2026-02-10"',
        "category: tourism",
        "tags:",
        "  - 海外旅行",
        "heroImage: /images/Test/cover.jpg",
        "regionIds:",
        "  - tokyo",
        "author: ともきち",
        "series:",
        "  slug: chagee",
      ].join("\n"),
    );
  });
});
