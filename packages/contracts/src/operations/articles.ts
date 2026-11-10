import type { ArticleDetailDto, ArticleSummaryDto, PublishCheckDto, RevisionDto } from "../dto.js";
import type { SitePublicationStatus } from "../publication.js";
import { v } from "../validation.js";
import { articleId, body, id, slug, summary, title } from "./fields.js";
import { operation } from "./spec.js";

const target = { type: "article", idField: "articleId" } as const;
const relation = v.literalUnion(["primary", "visited", "mentioned", "related"] as const);

export interface ArticleListDto {
  readonly items: readonly ArticleSummaryDto[];
  readonly total: number;
}
export interface BodyAuditDto {
  readonly items: readonly {
    readonly id: string;
    readonly slug: string;
    readonly status: string;
    readonly title: string;
    readonly path: string | null;
    readonly disallowedHtml: readonly string[];
    readonly inlineInternalLinks: readonly string[];
    readonly ineffectiveBold: readonly string[];
  }[];
  readonly total: number;
}
export interface PublishResultDto {
  readonly status: string;
  readonly publication: SitePublicationStatus | null;
}

export const articleOperations = {
  "article.list": operation<ArticleListDto>()({
    kind: "read",
    surface: "operator",
    input: v.object({
      query: v.describe(v.maybe(v.string({ max: 100 })), "タイトル・slug・URL などに含まれる語"),
    }),
    description:
      "旅行記事・固定ページの一覧（ID、タイトル、状態、URL、未公開の変更の有無、所属シリーズ・カテゴリー・地域の ID）。一言日記は list_diary_notes で別に取得します。プライバシーポリシー・利用規約などは固定ページで、記事と同じ get_article・save_article_draft・publish_article で編集・公開します。",
    tool: { name: "list_articles", title: "List articles" },
    target: { type: "article" },
  }),
  "article.get": operation<ArticleDetailDto>()({
    kind: "read",
    surface: "operator",
    input: v.object({ articleId }),
    description:
      "記事の現在の下書き本文（Markdown）、写真、関連付け、所属シリーズ、体験タグ、旅行日を取得します。一言日記には get_diary_note を使います。",
    tool: { name: "get_article", title: "Get article" },
    target,
  }),
  "article.create": operation<{ id: string }>()({
    kind: "write",
    surface: "operator",
    input: v.object({
      slug,
      path: v.describe(
        v.string({ min: 1, max: 255, pattern: /^\/[a-z0-9/-]+$/ }),
        "公開 URL のパス（例: /posts/slug）",
      ),
      kind: v.describe(
        v.optional(v.literalUnion(["article", "page"] as const), "article"),
        "article（旅行記事）か page（固定ページ）",
      ),
      title,
      summary,
      bodyMarkdown: body,
      seoTitleOverride: v.nullable(v.string({ max: 120 })),
      seoDescriptionOverride: v.nullable(v.string({ max: 400 })),
      changeSummary: v.nullable(v.string({ max: 400 })),
    }),
    description:
      "新しい記事を下書きとして作成します。公開はされません。URL は path で明示します（例: /posts/slug）。Apple Music は共有 URL を本文に1行で書くとプレーヤーになります。本文の写真は search_media の url を使います（保存時に記事の画像にも自動で追加されます）。",
    tool: { name: "create_article_draft", title: "Create article draft" },
    target: { type: "article" },
  }),
  "article.saveDraft": operation<{ revision: RevisionDto }>()({
    kind: "write",
    surface: "operator",
    input: v.object({
      articleId,
      title: v.maybe(title),
      summary: v.maybe(summary),
      bodyMarkdown: v.maybe(body),
      seoTitleOverride: v.maybe(v.nullable(v.string({ max: 120 }))),
      seoDescriptionOverride: v.maybe(v.nullable(v.string({ max: 400 }))),
      changeSummary: v.maybe(v.nullable(v.string({ max: 400 }))),
    }),
    description:
      "記事の下書きを保存します。指定しなかった項目は現在の内容のまま。公開中の記事でも、公開版は変わりません（公開は publish_article）。本文の写真は search_media の url を使います（保存時に記事の画像にも自動で追加されます）。",
    tool: { name: "save_article_draft", title: "Save article draft" },
    target,
  }),
  "article.publishCheck": operation<PublishCheckDto>()({
    kind: "read",
    surface: "operator",
    input: v.object({ articleId }),
    description:
      "記事が公開条件を満たすか（本文の長さ、カバー写真、Apple Music URL など）を確認します。",
    tool: { name: "check_publishable", title: "Check publishable" },
    target,
  }),
  "article.publish": operation<PublishResultDto>()({
    kind: "write",
    surface: "operator",
    input: v.object({
      articleId,
      deferBuild: v.describe(
        v.optional(v.boolean(), false),
        "true ならサイトの再生成を後回しにする（まとめて公開するとき。最後に publish_site）",
      ),
    }),
    description:
      "記事の保存済み下書きを公開し、サイトへの反映を開始します。実行前に check_publishable で確認し、利用者の明示的な指示があるときだけ使ってください。confirmArticleId に同じ ID を入れる必要があります。",
    tool: {
      name: "publish_article",
      title: "Publish article",
      confirm: {
        field: "confirmArticleId",
        sameAs: "articleId",
        description: "公開する記事の ID をもう一度",
      },
    },
    target,
    publishes: true,
  }),
  "article.unpublish": operation<PublishResultDto>()({
    kind: "write",
    surface: "operator",
    input: v.object({ articleId }),
    description:
      "公開中の記事を非公開（下書き）に戻し、サイトから取り下げます。URL は残り、あとで再公開できます。利用者の明示的な指示があるときだけ使い、confirm に unpublish を入れてください。",
    tool: {
      name: "unpublish_article",
      title: "Unpublish article",
      confirm: { field: "confirm", literal: "unpublish", description: "unpublish と入れる" },
    },
    target,
    publishes: true,
  }),
  "article.archive": operation<PublishResultDto>()({
    kind: "write",
    surface: "operator",
    input: v.object({ articleId }),
    description:
      "記事をアーカイブします（一覧の既定表示から外れ、サイトから取り下げます。削除ではなく、データと URL は残ります）。利用者の明示的な指示があるときだけ使い、confirm に archive を入れてください。",
    tool: {
      name: "archive_article",
      title: "Archive article",
      confirm: { field: "confirm", literal: "archive", description: "archive と入れる" },
    },
    target,
    publishes: true,
  }),
  "article.schedule": operation<{ status: string }>()({
    kind: "write",
    surface: "operator",
    input: v.object({
      articleId,
      at: v.describe(
        v.string({ min: 20, max: 40 }),
        "公開する日時（ISO 8601、例: 2026-12-01T09:00:00+09:00）",
      ),
    }),
    description:
      "記事の保存済み下書きを、指定した日時に公開する予約をします。公開条件を満たしている必要があります。",
    tool: { name: "schedule_article", title: "Schedule article" },
    target,
  }),
  "article.setRelations": operation<{ ok: true }>()({
    kind: "write",
    surface: "operator",
    input: v.object({
      articleId,
      collectionIds: v.describe(v.maybe(v.array(id, { max: 10 })), "所属シリーズ・旅程の ID"),
      tagIds: v.describe(v.maybe(v.array(id, { max: 50 })), "タグの ID"),
      categoryIds: v.describe(v.maybe(v.array(id, { max: 10 })), "カテゴリーの ID"),
      locations: v.describe(
        v.maybe(v.array(v.object({ locationId: id, relation }), { max: 50 })),
        "地域と関係（primary / visited / mentioned / related）",
      ),
      places: v.describe(
        v.maybe(v.array(v.object({ placeId: id, relation }), { max: 50 })),
        "スポットと関係",
      ),
    }),
    description:
      "記事の所属シリーズ・タグ・カテゴリー・地域・スポットを設定します（指定した項目だけ丸ごと置き換え、指定しなかった項目は変更しません）。ID は list_taxonomy・list_locations・list_places で調べます。公開中の記事は「変更を公開」で反映されます。",
    tool: { name: "set_article_series_and_tags", title: "Set article series, tags and places" },
    target,
  }),
  "article.setExperienceTags": operation<{ experienceTags: readonly string[] }>()({
    kind: "write",
    surface: "operator",
    input: v.object({
      articleId,
      experienceTags: v.describe(
        v.array(v.string({ max: 40 }), { max: 20 }),
        "exciting, moving, thrilling, disaster, funny, discovery, challenge, unforgettable から。[] で全部外す",
      ),
    }),
    description: "記事の体験タグ（その旅がどんな体験だったか）を丸ごと置き換えます。",
    tool: { name: "set_article_experience_tags", title: "Set article experience tags" },
    target,
  }),
  "article.setMedia": operation<{ ok: true }>()({
    kind: "write",
    surface: "operator",
    input: v.object({
      articleId: v.describe(id, "記事または一言日記の ID"),
      media: v.describe(
        v.array(
          v.object({
            mediaId: id,
            role: v.literalUnion(["cover", "inline", "gallery", "og"] as const),
            sortOrder: v.number({ integer: true, min: 0 }),
            alt: v.string({ min: 1, max: 300 }),
            caption: v.nullable(v.string({ max: 300 })),
          }),
          { max: 100 },
        ),
        "記事で使う写真の一覧（丸ごと置き換え）。role は cover（カバー）・inline（本文）・gallery・og",
      ),
    }),
    description:
      "記事（または一言日記）で使う写真の割り当てを丸ごと置き換えます。カバー写真・代替テキスト・キャプションをここで決めます。現在の割り当ては get_article の media で確認できます。",
    tool: { name: "set_article_media", title: "Set article media" },
    target,
  }),
  "article.bodyAudit": operation<BodyAuditDto>()({
    kind: "read",
    surface: "operator",
    input: v.object({}),
    description:
      '全記事の現在の下書き本文を点検し、問題のある記事だけを返します。disallowedHtml は公開チェックで弾かれる HTML 記法（<strong> 以外。広告リンクは [ラベル](URL "広告") と書けば rel と広告表記はビルド時に付く）、inlineInternalLinks は文中にあって記事リンクカードにならないサイト内リンク、ineffectiveBold は太字にならず ** がそのまま表示される箇所（日本語のカッコの隣では <strong> を使う）です。',
    tool: { name: "audit_article_bodies", title: "Audit article bodies" },
    target: { type: "article" },
  }),
};
