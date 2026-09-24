import { describe, expect, it } from "vitest";
import type { Article, ArticleRevision, Route } from "@tomokichi/domain";
import { articleMarkdownFiles, parseExportFiles } from "../export-format.js";
import { articleRow } from "../rows.js";
import { EMPTY_SNAPSHOT } from "../snapshot.js";

const article = {
  id: "a1",
  kind: "article",
  status: "published",
  locale: "ja",
  slug: "sample",
  authorId: "author",
  currentRevisionId: "r1",
  publishedRevisionId: "r1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  scheduledAt: null,
  publishedAt: "2026-01-01T00:00:00.000Z",
  archivedAt: null,
  noindex: false,
  travelStartDate: null,
  travelEndDate: null,
  experienceTags: ["exciting", "moving"],
} as unknown as Article;

const revision = {
  id: "r1",
  articleId: "a1",
  revisionNumber: 1,
  title: "タイトル",
  summary: "要約",
  bodyMarkdown: "本文",
} as unknown as ArticleRevision;

describe("export format: experience tags", () => {
  it("writes experience tags into the Markdown frontmatter as a YAML list", () => {
    const [file] = articleMarkdownFiles({
      ...EMPTY_SNAPSHOT,
      articles: [article],
      revisions: [revision],
      routes: [] as Route[],
    });
    expect(file?.contents).toContain('experienceTags:\n  - "exciting"\n  - "moving"\n---');
  });

  it("leaves the field out while an article has none", () => {
    const [file] = articleMarkdownFiles({
      ...EMPTY_SNAPSHOT,
      articles: [{ ...article, experienceTags: [] }],
      revisions: [revision],
    });
    expect(file?.contents).not.toContain("experienceTags");
  });

  it("reads an archive from before experience tags as untagged", () => {
    const legacy: Record<string, unknown> = { ...article };
    delete legacy.experienceTags;
    const snapshot = parseExportFiles((path) =>
      path === "articles.json" ? JSON.stringify([legacy]) : null,
    );
    expect(snapshot.articles[0]?.experienceTags).toEqual([]);
  });

  it("round-trips through a database row and drops retired values on read", () => {
    const row = articleRow.from(article);
    expect(row.experience_tags).toBe('["exciting","moving"]');
    expect(
      articleRow.to({ ...row, experience_tags: '["exciting","retired"]' }).experienceTags,
    ).toEqual(["exciting"]);
  });
});
