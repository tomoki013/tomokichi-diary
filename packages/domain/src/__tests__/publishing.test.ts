import { describe, expect, it } from "vitest";
import {
  archive,
  isIndexable,
  isPubliclyVisible,
  publish,
  schedule,
  unpublish,
  validatePublishable,
} from "../rules/publishing.js";
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

describe("validatePublishable", () => {
  it("accepts a complete draft", () => {
    expect(validatePublishable(base)).toEqual([]);
  });

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

  it("requires a cover image with alt text", () => {
    expect(validatePublishable({ ...base, media: [] })[0]?.field).toBe("media");
    expect(validatePublishable({ ...base, media: [makeCover({ alt: " " })] })[0]?.field).toBe(
      "media",
    );
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
