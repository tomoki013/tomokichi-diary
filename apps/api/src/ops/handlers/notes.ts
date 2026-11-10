import {
  createArticle,
  deleteDiaryNote,
  publishArticle,
  setDiaryNotePublicationDate,
  setDiaryNoteRelatedArticles,
  unpublishArticle,
  updateArticleDraft,
} from "@tomokichi/application";
import { instantFrom, parsePlainDate, type ArticleId } from "@tomokichi/domain";
import { toRevisionDto } from "../../mappers.js";
import { unwrap, type Handlers } from "../scope.js";
import { contentDetail, listContent, publishCheck, requireContent, siteAuthor } from "./content.js";

type Names =
  | "note.list"
  | "note.get"
  | "note.create"
  | "note.saveDraft"
  | "note.publishCheck"
  | "note.publish"
  | "note.unpublish"
  | "note.setDate"
  | "note.setRelatedArticles"
  | "note.delete";

/** A note has no summary of its own: its card description is the start of its body. */
function descriptionFor(title: string, markdown: string): string {
  const plain = markdown
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_>#~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (plain || title).slice(0, 400);
}

export const noteHandlers: Handlers<Names> = {
  "note.list": ({ ctx }) => listContent(ctx, (article) => article.kind === "note"),

  "note.get": async (scope, { noteId }) =>
    contentDetail(scope, await requireContent(scope.ctx, noteId, "note")),

  "note.create": async ({ ctx, env }, { slug, title, bodyMarkdown }) => {
    const created = unwrap(
      await createArticle(ctx, {
        slug,
        kind: "note",
        locale: "ja",
        authorId: await siteAuthor(ctx),
        path: `/notes/${slug}`,
        draft: {
          title,
          summary: descriptionFor(title, bodyMarkdown),
          bodyMarkdown,
          seoTitleOverride: null,
          seoDescriptionOverride: null,
          changeSummary: "一言日記の下書きを作成",
        },
        imageBase: env.PUBLIC_IMAGE_URL,
      }),
    );
    return { id: created.article.id };
  },

  "note.saveDraft": async ({ ctx, env }, input) => {
    const note = await requireContent(ctx, input.noteId, "note");
    const current = note.currentRevisionId
      ? await ctx.repos.revisions.findById(note.currentRevisionId)
      : null;
    const title = input.title ?? current?.title ?? "";
    const bodyMarkdown = input.bodyMarkdown ?? current?.bodyMarkdown ?? "";
    const saved = unwrap(
      await updateArticleDraft(
        ctx,
        note.id,
        {
          title,
          summary: descriptionFor(title, bodyMarkdown),
          bodyMarkdown,
          seoTitleOverride: null,
          seoDescriptionOverride: null,
          changeSummary: "一言日記を編集",
        },
        note.authorId,
        env.PUBLIC_IMAGE_URL,
      ),
    );
    return { revision: toRevisionDto(saved.revision) };
  },

  "note.publishCheck": async ({ ctx }, { noteId }) =>
    publishCheck(ctx, (await requireContent(ctx, noteId, "note")).id),

  "note.publish": async (scope, { noteId, deferBuild }) => {
    const note = await requireContent(scope.ctx, noteId, "note");
    const published = unwrap(await publishArticle(scope.ctx, note.id));
    return { status: published.status, publication: await scope.publishSite(deferBuild) };
  },

  "note.unpublish": async (scope, { noteId }) => {
    const note = await requireContent(scope.ctx, noteId, "note");
    const result = unwrap(await unpublishArticle(scope.ctx, note.id));
    return { status: result.status, publication: await scope.publishSite() };
  },

  "note.setDate": async (scope, { noteId, date }) => {
    const note = await requireContent(scope.ctx, noteId, "note");
    // A date-only value is stored at UTC midnight so its calendar date stays
    // the same in the public export and in the editor.
    const publishedAt =
      date === null ? null : instantFrom(`${unwrap(parsePlainDate(date))}T00:00:00.000Z`);
    const saved = unwrap(await setDiaryNotePublicationDate(scope.ctx, note.id, publishedAt));
    return {
      date: saved.publishedAt?.slice(0, 10) ?? null,
      publication: saved.status === "published" ? await scope.publishSite() : null,
    };
  },

  "note.setRelatedArticles": async ({ ctx }, { noteId, relatedArticleIds }) => {
    const note = await requireContent(ctx, noteId, "note");
    return {
      relatedArticleIds: unwrap(
        await setDiaryNoteRelatedArticles(ctx, note.id, relatedArticleIds as ArticleId[]),
      ),
    };
  },

  "note.delete": async (scope, { noteId }) => {
    const note = await requireContent(scope.ctx, noteId, "note");
    unwrap(await deleteDiaryNote(scope.ctx, note.id));
    return {
      deleted: true,
      publication: note.status === "published" ? await scope.publishSite() : null,
    };
  },
};
