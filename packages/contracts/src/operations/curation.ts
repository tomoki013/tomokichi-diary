import type {
  CollectionAdminDto,
  LocationDto,
  RankingAdminDto,
  TagDto,
  TaxonomyDto,
} from "../dto.js";
import { v } from "../validation.js";
import { id, slug } from "./fields.js";
import { operation } from "./spec.js";

const collectionKind = v.literalUnion(["series", "journey"] as const);
const seriesTarget = { type: "series", idField: "collectionId" } as const;
const rankingTarget = { type: "ranking", idField: "rankingId" } as const;

/** One search-only word and the other ways readers type it. */
export interface SearchWordDto {
  readonly word: string;
  readonly also: readonly string[];
}
const searchWord = v.object({
  word: v.describe(v.string({ min: 1, max: 60 }), "記事に出てくる書き方（例: CHAGEE）"),
  also: v.describe(
    v.array(v.string({ min: 1, max: 60 }), { max: 12 }),
    "読者が打つ別の書き方（例: チャジー、霸王茶姬）",
  ),
});

export interface PlaceDto {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly kind: string;
  readonly locationId: string | null;
}

const articleDefaults = v.object({
  tagIds: v.array(id, { max: 50 }),
  categoryIds: v.array(id, { max: 10 }),
  experienceTags: v.array(v.string({ max: 40 }), { max: 20 }),
});
const themeMusic = v.object({
  provider: v.string({ max: 40 }),
  url: v.string({ max: 2048 }),
  title: v.nullable(v.string({ max: 200 })),
  enabled: v.boolean(),
});
const picks = v.describe(
  v.array(
    v.object({
      article: v.describe(id, "記事の ID または slug"),
      comment: v.describe(
        v.optional(v.string({ max: 80 }), ""),
        "なぜこの順位か。省くとタイトルだけ",
      ),
    }),
    { max: 15 },
  ),
  "1位から順に。渡すと順位を丸ごと置き換えます",
);
const rankingChanges = {
  note: v.describe(v.maybe(v.string({ max: 40 })), "手書き風の添え書き"),
  experienceTag: v.describe(
    v.maybe(v.nullable(v.string({ max: 40 }))),
    "「もっと読む」の行き先の体験タグ。null で外す",
  ),
  photoMediaId: v.describe(
    v.maybe(v.nullable(id)),
    "ランキングに表示する写真のメディア ID。null で外す",
  ),
  picks: v.maybe(picks),
  sortOrder: v.maybe(v.number({ integer: true, min: 0 })),
};

export const curationOperations = {
  "series.list": operation<{ items: readonly CollectionAdminDto[] }>()({
    kind: "read",
    surface: "operator",
    input: v.object({
      kind: v.describe(v.maybe(collectionKind), "series か journey。省くと両方"),
    }),
    description:
      "シリーズ・旅程の一覧（公開記事数、URL、カバー、表示順、テーマ曲、記事に付ける既定のタグ）。",
    tool: { name: "list_series", title: "List series" },
    target: { type: "series" },
  }),
  "series.get": operation<CollectionAdminDto>()({
    kind: "read",
    surface: "operator",
    input: v.object({ collectionId: id }),
    description: "シリーズ・旅程を1件取得します。",
    tool: { name: "get_series", title: "Get series" },
    target: seriesTarget,
  }),
  "series.create": operation<CollectionAdminDto>()({
    kind: "write",
    surface: "operator",
    input: v.object({
      kind: v.optional(collectionKind, "series"),
      slug,
      title: v.string({ min: 1, max: 80 }),
      description: v.nullable(v.string({ max: 400 })),
      coverMediaId: v.nullable(id),
      sortOrder: v.nullable(v.number({ integer: true, min: 0 })),
    }),
    description: "シリーズを作成します（URL は /collections/<slug>、作成後 slug は変更不可）。",
    tool: { name: "create_series", title: "Create series" },
    target: { type: "series" },
  }),
  "series.update": operation<CollectionAdminDto>()({
    kind: "write",
    surface: "operator",
    input: v.object({
      collectionId: id,
      title: v.maybe(v.string({ min: 1, max: 80 })),
      description: v.maybe(v.nullable(v.string({ max: 400 }))),
      coverMediaId: v.maybe(v.nullable(id)),
      sortOrder: v.maybe(v.number({ integer: true, min: 0 })),
      themeMusic: v.describe(
        v.maybe(v.nullable(themeMusic)),
        "テーマ曲（Apple Music の共有 URL）。null で外す",
      ),
      articleDefaults: v.describe(
        v.maybe(articleDefaults),
        "このシリーズに記事を入れたとき一緒に付けるタグ・カテゴリー・体験タグ",
      ),
    }),
    description:
      "シリーズの名前・説明・カバー・表示順・テーマ曲・記事の既定タグを変更します（指定した項目だけ）。slug と URL は変わりません。",
    tool: { name: "update_series", title: "Update series" },
    target: seriesTarget,
  }),
  "tag.create": operation<TagDto>()({
    kind: "write",
    surface: "operator",
    input: v.object({ slug, name: v.string({ min: 1, max: 80 }) }),
    description: "タグを作成します。既存のタグと slug・名前が重複する場合は作成されません。",
    tool: { name: "create_tag", title: "Create tag" },
    target: { type: "tag" },
  }),
  "taxonomy.get": operation<TaxonomyDto>()({
    kind: "read",
    surface: "operator",
    input: v.object({}),
    description: "カテゴリー・タグ・シリーズ/旅程コレクションの ID と名前を一覧します。",
    tool: { name: "list_taxonomy", title: "List categories, tags and collections" },
    target: { type: "tag" },
  }),
  "location.list": operation<{ items: readonly LocationDto[] }>()({
    kind: "read",
    surface: "operator",
    input: v.object({}),
    description: "地域（国・都市など）の ID、名前、親子関係を一覧します。",
    tool: { name: "list_locations", title: "List locations" },
    target: { type: "location" },
  }),
  "place.list": operation<{ items: readonly PlaceDto[] }>()({
    kind: "read",
    surface: "operator",
    input: v.object({}),
    description: "スポット（観光地・店など）の ID、名前、所在地域を一覧します。",
    tool: { name: "list_places", title: "List places" },
    target: { type: "location" },
  }),
  "ranking.list": operation<{ items: readonly RankingAdminDto[] }>()({
    kind: "read",
    surface: "operator",
    input: v.object({}),
    description:
      "トップページの「ともきち的ランキング」の一覧（ID、名前、添え書き、選択中の写真、もっと読むの体験タグ、表示順、順位ごとの記事と一言、公開中の本数）。公開中の記事が0本のランキングはサイトに出ません。",
    tool: { name: "list_rankings", title: "List rankings" },
    target: { type: "ranking" },
  }),
  "ranking.get": operation<RankingAdminDto>()({
    kind: "read",
    surface: "operator",
    input: v.object({ rankingId: id }),
    description: "ランキングを1件取得します。",
    tool: { name: "get_ranking", title: "Get ranking" },
    target: rankingTarget,
  }),
  "ranking.create": operation<RankingAdminDto>()({
    kind: "write",
    surface: "operator",
    input: v.object({ title: v.string({ min: 1, max: 60 }), ...rankingChanges }),
    description:
      "ランキングを新しく作ります（末尾に追加）。保存はDBだけで、トップページへの反映は publish_site。",
    tool: { name: "create_ranking", title: "Create ranking" },
    target: { type: "ranking" },
  }),
  "ranking.update": operation<RankingAdminDto>()({
    kind: "write",
    surface: "operator",
    input: v.object({
      rankingId: id,
      title: v.maybe(v.string({ min: 1, max: 60 })),
      ...rankingChanges,
    }),
    description:
      "ランキングの名前・添え書き・写真・もっと読む・表示順・順位（記事と一言）を変更します。picks は丸ごと置き換え。下書きの記事も入れられますが、公開されるまでサイトには出ません。保存はDBだけで、トップページへの反映は publish_site。",
    tool: { name: "update_ranking", title: "Update ranking" },
    target: rankingTarget,
  }),
  "search.words": operation<{ items: readonly SearchWordDto[] }>()({
    kind: "read",
    surface: "operator",
    input: v.object({}),
    description:
      "サイト内検索だけに使う別名の一覧（記事に出てくる語と、読者が打つ別の書き方）。サイトには表示されません。",
    tool: { name: "list_search_words", title: "List search words" },
    target: { type: "search_words" },
  }),
  "search.saveWords": operation<{ items: readonly SearchWordDto[] }>()({
    kind: "write",
    surface: "operator",
    input: v.object({ words: v.array(searchWord, { max: 300 }) }),
    description:
      "サイト内検索の別名を保存します（一覧を丸ごと置き換え）。word は記事に出てくる書き方、also は読みや別表記。記事の題・要約・タグ・本文に word か also のどれかが出てくる記事が、そのすべてで見つかるようになります。ひらがなとカタカナ、全角と半角、大文字と小文字は同じ扱いなので片方だけで足ります。保存はDBだけで、サイトへの反映は publish_site。",
    tool: { name: "save_search_words", title: "Save search words" },
    target: { type: "search_words" },
  }),
};
