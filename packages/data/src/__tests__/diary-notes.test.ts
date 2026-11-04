import { describe, expect, it } from "vitest";
import type { Article, ArticleRevision, NoteRelatedArticle, Route } from "@tomokichi/domain";
import type { ContentSnapshot } from "../snapshot.js";
import { EMPTY_SNAPSHOT, buildExportFiles, parseExportFiles } from "../index.js";

const note: Article = {
  id: "note-1" as Article["id"],
  kind: "note",
  status: "published",
  locale: "ja",
  slug: "santorini-memory" as Article["slug"],
  authorId: "author-1" as Article["authorId"],
  currentRevisionId: "revision-1" as Article["currentRevisionId"],
  publishedRevisionId: "revision-1" as Article["publishedRevisionId"],
  createdAt: "2026-06-01T00:00:00.000Z" as Article["createdAt"],
  updatedAt: "2026-06-01T00:00:00.000Z" as Article["updatedAt"],
  scheduledAt: null,
  publishedAt: "2026-06-01T00:00:00.000Z" as Article["publishedAt"],
  archivedAt: null,
  travelStartDate: null,
  travelEndDate: null,
  experienceTags: [],
  noindex: false,
};

const revision: ArticleRevision = {
  id: "revision-1" as ArticleRevision["id"],
  articleId: note.id,
  revisionNumber: 1,
  title: "テレビで見かけたサントリーニ島",
  summary: "自分が行った場所をテレビで見ると、なんか嬉しい。",
  bodyMarkdown: "自分が行った場所をテレビで見ると、なんか嬉しい。",
  seoTitleOverride: null,
  seoDescriptionOverride: null,
  changeSummary: null,
  createdAt: note.createdAt,
  createdBy: note.authorId,
};

const routes: Route[] = [
  {
    id: "route-notes" as Route["id"],
    path: "/notes" as Route["path"],
    locale: "ja",
    targetType: "static",
    targetId: "notes",
    isCanonical: true,
    redirectTo: null,
    redirectStatus: null,
    isLegacy: false,
    noindex: false,
  },
  {
    id: "route-note" as Route["id"],
    path: "/notes/santorini-memory" as Route["path"],
    locale: "ja",
    targetType: "article",
    targetId: note.id,
    isCanonical: true,
    redirectTo: null,
    redirectStatus: null,
    isLegacy: false,
    noindex: false,
  },
];

describe("diary note export", () => {
  it("keeps the note kind, note route and related travel article through export and import", () => {
    const relation: NoteRelatedArticle = {
      noteId: note.id,
      articleId: "article-1" as NoteRelatedArticle["articleId"],
      sortOrder: 0,
    };
    const snapshot: ContentSnapshot = {
      ...EMPTY_SNAPSHOT,
      articles: [note],
      revisions: [revision],
      routes,
      noteRelatedArticles: [relation],
    };
    const files = buildExportFiles(snapshot);
    const byPath = new Map(files.map((file) => [file.path, file.contents]));
    expect(byPath.get("articles/santorini-memory.md")).toContain('kind: "note"');
    expect(byPath.get("articles/santorini-memory.md")).toContain('path: "/notes/santorini-memory"');
    expect(byPath.get("relations/note-related-articles.json")).toContain('"noteId": "note-1"');

    const imported = parseExportFiles((path) => byPath.get(path) ?? null);
    expect(imported.articles[0]?.kind).toBe("note");
    expect(imported.routes).toEqual(routes);
    expect(imported.noteRelatedArticles).toEqual([relation]);
  });
});
