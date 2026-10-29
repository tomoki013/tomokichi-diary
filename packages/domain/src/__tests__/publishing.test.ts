import { describe, expect, it } from "vitest";
import {
  archive,
  isIndexable,
  isPubliclyVisible,
  publicModifiedAt,
  publish,
  schedule,
  unpublish,
  validatePublishable,
} from "../rules/publishing.js";
import {
  disallowedHtml,
  ineffectiveBold,
  inlineAffiliateLinks,
  inlineInternalLinks,
} from "../rules/markdown.js";
import { hasUnpublishedChanges, nextRevision } from "../rules/revision.js";
import { asId, type RevisionId } from "../primitives/id.js";
import { AUTHOR, NOW, at, makeArticle, makeCover, makeRevision, makeRoute } from "./fixtures.js";

const base = {
  article: makeArticle(),
  revision: makeRevision(),
  canonicalRoute: makeRoute(),
  media: [makeCover()],
  now: NOW,
};

const body = (link: string) =>
  makeRevision({ bodyMarkdown: `${"本文".repeat(120)}\n\n[関連記事](${link})` });

const withImages = (images: string) =>
  makeRevision({ bodyMarkdown: `${"本文".repeat(120)}\n\n${images}` });

describe("validatePublishable", () => {
  it("requires a title, a summary and a substantial body", () => {
    const errors = validatePublishable({
      ...base,
      revision: makeRevision({ title: "  ", summary: "", bodyMarkdown: "短い" }),
    });
    expect(errors.map((e) => e.field)).toEqual(["title", "summary", "bodyMarkdown"]);
    expect(errors.every((e) => e.code === "ARTICLE_NOT_PUBLISHABLE")).toBe(true);
  });

  it("requires a canonical route that points back at the article", () => {
    expect(validatePublishable({ ...base, canonicalRoute: undefined })).toHaveLength(1);
    const mismatched = validatePublishable({
      ...base,
      canonicalRoute: makeRoute({ targetId: "article-99" }),
    });
    expect(mismatched[0]?.field).toBe("route");
  });

  it("requires alt text on every body image", () => {
    expect(
      validatePublishable({
        ...base,
        revision: withImages("![塔](/a.jpg)\n\n![](<https://x/b.jpg>)"),
      }),
    ).toEqual([
      expect.objectContaining({
        field: "bodyMarkdown",
        message: expect.stringContaining("https://x/b.jpg"),
      }),
    ]);
    expect(
      validatePublishable({ ...base, revision: withImages("```\n![](/code.jpg)\n```") }),
    ).toEqual([]);
  });

  it("requires a cover image with alt text", () => {
    expect(validatePublishable({ ...base, media: [] })[0]?.field).toBe("media");
    expect(validatePublishable({ ...base, media: [makeCover({ alt: " " })] })[0]?.field).toBe(
      "media",
    );
  });

  it("rejects internal links that no route answers", () => {
    const routes = [
      makeRoute(),
      makeRoute({ id: "route-2" as never, path: "/posts/other" as never }),
    ];
    expect(validatePublishable({ ...base, routes, revision: body("/posts/other#top") })).toEqual(
      [],
    );
    expect(validatePublishable({ ...base, routes, revision: body("/rss.xml") })).toEqual([]);
    const errors = validatePublishable({ ...base, routes, revision: body("/posts/missing") });
    expect(errors.map((e) => e.message)).toEqual([
      "internal link target does not exist: /posts/missing",
    ]);
  });

  it("rejects a revision belonging to another article", () => {
    const errors = validatePublishable({
      ...base,
      revision: makeRevision({ articleId: "article-2" as never }),
    });
    expect(errors.map((e) => e.field)).toContain("revisionId");
  });

  it("holds a scheduled article until its time arrives", () => {
    const article = makeArticle({
      status: "scheduled",
      scheduledAt: at("2026-09-01T00:00:00.000Z"),
    });
    expect(validatePublishable({ ...base, article })).toHaveLength(1);
    expect(validatePublishable({ ...base, article, now: at("2026-09-02T00:00:00.000Z") })).toEqual(
      [],
    );
  });
});

describe("publish", () => {
  it("swaps the published pointer and keeps the first publication date", () => {
    const result = publish(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("published");
    expect(result.value.publishedRevisionId).toBe(base.revision.id);
    expect(result.value.publishedAt).toBe(NOW);

    const republished = publish({
      ...base,
      article: result.value,
      now: at("2026-12-01T00:00:00.000Z"),
    });
    expect(republished.ok && republished.value.publishedAt).toBe(NOW);
  });

  it("does not publish an invalid draft", () => {
    const result = publish({ ...base, media: [] });
    expect(result.ok).toBe(false);
  });

  it("refuses archived articles", () => {
    const result = publish({ ...base, article: makeArticle({ status: "archived" }) });
    expect(result.ok).toBe(false);
  });
});

describe("lifecycle transitions", () => {
  it("unpublish and archive both hide the article", () => {
    const published = publish(base);
    if (!published.ok) throw new Error("fixture should publish");
    expect(isPubliclyVisible(unpublish(published.value, NOW), NOW)).toBe(false);
    expect(isPubliclyVisible(archive(published.value, NOW), NOW)).toBe(false);
  });

  it("schedule refuses a time in the past", () => {
    expect(schedule(makeArticle(), at("2020-01-01T00:00:00.000Z"), NOW).ok).toBe(false);
    expect(schedule(makeArticle(), at("2027-01-01T00:00:00.000Z"), NOW).ok).toBe(true);
  });
});

describe("visibility", () => {
  const published = makeArticle({
    status: "published",
    publishedRevisionId: asId<RevisionId>("rev-1"),
    publishedAt: at("2026-08-24T00:00:00.000Z"),
  });

  it("is visible once the publication date has passed", () => {
    expect(isPubliclyVisible(published, NOW)).toBe(true);
    expect(isPubliclyVisible(published, at("2026-08-01T00:00:00.000Z"))).toBe(false);
  });

  it("noindex articles stay reachable but are not indexable", () => {
    const hidden = { ...published, noindex: true };
    expect(isPubliclyVisible(hidden, NOW)).toBe(true);
    expect(isIndexable(hidden, NOW)).toBe(false);
  });
});

describe("revisions", () => {
  it("increments the revision number instead of mutating the previous one", () => {
    const previous = makeRevision();
    const next = nextRevision({
      article: makeArticle(),
      previous,
      id: asId<RevisionId>("rev-2"),
      input: { title: "新しい題名", summary: "要約", bodyMarkdown: "本文".repeat(200) },
      createdBy: AUTHOR,
      now: NOW,
    });
    expect(next.revisionNumber).toBe(2);
    expect(previous.title).toBe("CHAGEEのメニューを日本語で解説");
  });

  it("reports a draft that is ahead of what is published", () => {
    expect(
      hasUnpublishedChanges(
        makeArticle({
          currentRevisionId: asId<RevisionId>("rev-2"),
          publishedRevisionId: asId<RevisionId>("rev-1"),
        }),
      ),
    ).toBe(true);
    expect(
      hasUnpublishedChanges(
        makeArticle({
          currentRevisionId: asId<RevisionId>("rev-1"),
          publishedRevisionId: asId<RevisionId>("rev-1"),
        }),
      ),
    ).toBe(false);
  });
});

describe("body formatting", () => {
  it("rejects raw HTML except strong", () => {
    const markdown = [
      '<strong>「霸王茶姬」</strong>は<br>雲南発。<span class="x">色</span>',
      '<a href="https://omio.sjv.io/x" rel="sponsored nofollow noopener">Omio</a>',
      '<small class="affiliate-inline-disclosure">広告</small>',
      '<a href="/posts/x">内部</a> と `<em>コード</em>` と <https://example.com>',
      "![写真](<https://x/a.jpg>)",
      '![エッフェル塔](</images/France/eiffel-tower.jpg>) と [記事](</posts/x> "題")',
    ].join("\n\n");
    expect(disallowedHtml(markdown)).toEqual([
      "<br>",
      '<span class="x">',
      "</span>",
      '<a href="https://omio.sjv.io/x" rel="sponsored nofollow noopener">',
      "</a>",
      '<small class="affiliate-inline-disclosure">',
      "</small>",
      '<a href="/posts/x">',
    ]);
    expect(
      validatePublishable({
        ...base,
        revision: makeRevision({ bodyMarkdown: `${"本文".repeat(120)}\n\n改行<br>` }),
      }),
    ).toEqual([
      expect.objectContaining({ field: "bodyMarkdown", message: expect.stringContaining("<br>") }),
    ]);
  });

  it("finds site links that sit in a sentence instead of on their own line", () => {
    const markdown = [
      "詳しくは[メニュー](./menu)で。外部は[公式](https://chagee.com)。",
      "[カードになる](./card)",
      "- [一覧のカード](/posts/list)\n- 文中の[一覧](https://tomokichidiary.com/posts/in-list)です",
      "> 引用の[記事](../quoted)も",
      "| 表 | [セル](./cell) |\n| --- | --- |",
      "```\n[コード](./code)\n```",
      "![写真](/images/a.jpg) と [目次](#top)",
    ].join("\n\n");
    expect(inlineInternalLinks(markdown)).toEqual([
      "./menu",
      "https://tomokichidiary.com/posts/in-list",
      "../quoted",
    ]);
  });

  it("finds bold the renderer leaves as asterisks next to Japanese punctuation", () => {
    // Each expectation was checked against the site's renderer (satteri).
    const works = [
      "**太字**です",
      "あ**太字**い",
      "**1人RM2**。",
      "**9:00〜18:00**、",
      "これは、**「名前」**",
      "「**名前**」",
      "a **b** c",
      "**「x」**",
      "（**注意**）は",
      "`**コード**`です",
    ];
    for (const markdown of works) expect(ineffectiveBold(markdown), markdown).toEqual([]);
    expect(ineffectiveBold("**「霸王茶姬」**は")).toEqual(["**「霸王茶姬」**"]);
    expect(ineffectiveBold("行政都市**プトラジャヤ（Putrajaya）**です")).toEqual([
      "**プトラジャヤ（Putrajaya）**",
    ]);
    expect(ineffectiveBold("前**（注）**後\n\n<strong>「霸王茶姬」</strong>は")).toEqual([
      "**（注）**",
    ]);
  });

  it("reads the inline affiliate links, and only those", () => {
    const markdown = [
      '[Omioで探す](https://omio.sjv.io/a "広告")と[公式](https://renfe.com "Renfe")。',
      '![写真](https://x/a.jpg "広告") と `[コード](https://x "広告")`',
      '[Agoda](<https://agoda.com/p?a=1&b=2> "広告")',
    ].join("\n\n");
    expect(inlineAffiliateLinks(markdown)).toEqual([
      "https://omio.sjv.io/a",
      "https://agoda.com/p?a=1&b=2",
    ]);
  });
});

describe("publicModifiedAt", () => {
  const live = makeArticle({
    publishedAt: at("2026-08-24T00:00:00.000Z"),
    updatedAt: at("2026-10-28T22:00:00.000Z"),
  });

  it("follows the published revision, never a later draft save", () => {
    const revision = makeRevision({ createdAt: at("2026-09-10T00:00:00.000Z") });
    expect(publicModifiedAt(live, revision)).toBe("2026-09-10T00:00:00.000Z");
  });

  it("is the first publication when the revision was written before it", () => {
    const revision = makeRevision({ createdAt: at("2026-08-01T00:00:00.000Z") });
    expect(publicModifiedAt(live, revision)).toBe("2026-08-24T00:00:00.000Z");
  });
});
