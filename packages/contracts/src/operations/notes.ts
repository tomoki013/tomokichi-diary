import type { ArticleDetailDto, PublishCheckDto, RevisionDto } from "../dto.js";
import type { SitePublicationStatus } from "../publication.js";
import { v } from "../validation.js";
import type { ArticleListDto, PublishResultDto } from "./articles.js";
import { id, noteId, plainDate, slug, title } from "./fields.js";
import { operation } from "./spec.js";

const target = { type: "note", idField: "noteId" } as const;

export const noteOperations = {
  "note.list": operation<ArticleListDto>()({
    kind: "read",
    surface: "operator",
    input: v.object({}),
    description:
      "ともきちの一言日記の一覧を取得します。旅行記事とは分けて返し、下書き・公開中・未公開変更の状態も含みます。",
    tool: { name: "list_diary_notes", title: "List diary notes" },
    target: { type: "note" },
  }),
  "note.get": operation<ArticleDetailDto>()({
    kind: "read",
    surface: "operator",
    input: v.object({ noteId }),
    description: "一言日記の下書き本文、投稿日、写真、関連記事、公開状態を取得します。",
    tool: { name: "get_diary_note", title: "Get diary note" },
    target,
  }),
  "note.create": operation<{ id: string }>()({
    kind: "write",
    surface: "operator",
    input: v.object({
      slug,
      title,
      bodyMarkdown: v.optional(v.string({ max: 200_000 }), ""),
    }),
    description:
      "一言日記を未公開の下書きとして作成します。タイトルと URL 用 slug を指定します。本文はあとから書けます。作成だけでは公開されません。",
    tool: { name: "create_diary_note_draft", title: "Create diary note draft" },
    target: { type: "note" },
  }),
  "note.saveDraft": operation<{ revision: RevisionDto }>()({
    kind: "write",
    surface: "operator",
    input: v.object({
      noteId,
      title: v.maybe(title),
      bodyMarkdown: v.maybe(v.string({ max: 200_000 })),
    }),
    description:
      "一言日記の下書きを保存します。指定しなかったタイトル・本文は現在の内容のままです。公開中の日記の公開版は変わりません。",
    tool: { name: "save_diary_note_draft", title: "Save diary note draft" },
    target,
  }),
  "note.publishCheck": operation<PublishCheckDto>()({
    kind: "read",
    surface: "operator",
    input: v.object({ noteId }),
    description:
      "一言日記のタイトル、本文、URL、写真などを公開前に検証します。公開操作は行いません。",
    tool: { name: "check_diary_note_publishable", title: "Check diary note publishable" },
    target,
  }),
  "note.publish": operation<PublishResultDto>()({
    kind: "write",
    surface: "operator",
    input: v.object({ noteId, deferBuild: v.optional(v.boolean(), false) }),
    description:
      "一言日記の保存済み下書きを公開し、静的サイトへの反映を開始します。利用者から一言日記の公開を明示的に頼まれた場合だけ実行し、confirm に publish を指定してください。公開前検証に通らない日記は公開されません。",
    tool: {
      name: "publish_diary_note",
      title: "Publish diary note",
      confirm: { field: "confirm", literal: "publish", description: "publish と入れる" },
    },
    target,
    publishes: true,
  }),
  "note.unpublish": operation<PublishResultDto>()({
    kind: "write",
    surface: "operator",
    input: v.object({ noteId }),
    description:
      "一言日記を公開取り下げにし、公開サイトから外します。利用者から取り下げを明示的に頼まれた場合だけ実行し、confirm に unpublish を指定してください。",
    tool: {
      name: "unpublish_diary_note",
      title: "Unpublish diary note",
      confirm: { field: "confirm", literal: "unpublish", description: "unpublish と入れる" },
    },
    target,
    publishes: true,
  }),
  "note.setDate": operation<{
    date: string | null;
    publication: SitePublicationStatus | null;
  }>()({
    kind: "write",
    surface: "operator",
    input: v.object({
      noteId,
      date: v.describe(v.nullable(plainDate), "投稿日（YYYY-MM-DD）。null で公開時の日付に戻す"),
    }),
    description:
      "一言日記の投稿日を変更します。公開中の日記では、保存と同時にサイトへの反映を開始します。",
    tool: { name: "set_diary_note_date", title: "Set diary note date" },
    target,
  }),
  "note.setRelatedArticles": operation<{ relatedArticleIds: readonly string[] }>()({
    kind: "write",
    surface: "operator",
    input: v.object({ noteId, relatedArticleIds: v.array(id, { max: 10 }) }),
    description:
      "一言日記に関連する旅行記事を設定します。公開中の日記では、保存後に publish_diary_note を明示して実行するまで公開版に反映されません。",
    tool: {
      name: "set_diary_note_related_articles",
      title: "Set diary note related articles",
    },
    target,
  }),
  "note.delete": operation<{ deleted: true; publication: SitePublicationStatus | null }>()({
    kind: "delete",
    surface: "operator",
    input: v.object({ noteId, confirm: v.literalUnion(["delete"] as const) }),
    description: "一言日記を削除します。管理画面からだけ実行できます。",
    target,
  }),
};
