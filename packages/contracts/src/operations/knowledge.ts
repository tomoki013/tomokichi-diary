import type { ArticleKnowledgeBundleDto, TravelFactDto } from "../dto.js";
import { v } from "../validation.js";
import { articleId, id, plainDate } from "./fields.js";
import { operation } from "./spec.js";

const target = { type: "knowledge", idField: "articleId" } as const;
const provenance = v.literalUnion(["firsthand", "official", "researched", "derived"] as const);
const factKind = v.literalUnion([
  "visit",
  "food_drink",
  "transport",
  "cost",
  "duration",
  "procedure",
  "observation",
  "recommendation",
  "warning",
  "current_fact",
] as const);

export interface KnowledgeBacklogDto {
  readonly migrated: number;
  readonly pending: number;
  /** Published articles with no knowledge record yet. */
  readonly items: readonly { id: string; slug: string; title: string; path: string | null }[];
}
export interface PendingFactDto extends TravelFactDto {
  readonly article: { id: string; slug: string; title: string } | null;
}

export const knowledgeOperations = {
  "knowledge.get": operation<ArticleKnowledgeBundleDto>()({
    kind: "read",
    surface: "operator",
    input: v.object({ articleId }),
    description:
      "記事の「旅の知識」（要点、判断表、事実、出典、ルート）を取得します。事実には出どころ（firsthand 一次体験 / official 公式 / researched 調査 / derived 推定）と状態（candidate 候補 / verified 確認済み）が付きます。",
    tool: { name: "get_article_knowledge", title: "Get article knowledge" },
    target,
  }),
  "knowledge.save": operation<ArticleKnowledgeBundleDto>()({
    kind: "write",
    surface: "operator",
    input: v.object({ articleId, bundle: v.unknown() }),
    description:
      "記事の「旅の知識」を保存します。bundle は get_article_knowledge と同じ形（article, facts, sources, routes）。新しい事実と、文面・日付・出どころを変えた事実は候補（candidate）として入り、確認済みにできるのは管理画面の本人だけです。事実の候補を足すだけなら propose_travel_facts が簡単です。",
    tool: { name: "save_article_knowledge", title: "Save article knowledge" },
    target,
  }),
  "knowledge.proposeFacts": operation<{ added: readonly TravelFactDto[] }>()({
    kind: "write",
    surface: "operator",
    input: v.object({
      articleId,
      facts: v.array(
        v.object({
          statement: v.describe(
            v.string({ min: 1, max: 4_000 }),
            "本文に明示されている事実を1文で。本文にないことは書かない",
          ),
          kind: factKind,
          provenance: v.describe(
            provenance,
            "firsthand（筆者が体験した）/ official（公式情報）/ researched（調べた）/ derived（推定）",
          ),
          experiencedAt: v.describe(
            v.nullable(plainDate),
            "体験した日（YYYY-MM-DD）。不明なら null",
          ),
        }),
        { max: 100 },
      ),
    }),
    description:
      "記事の本文から読み取った事実を「候補」として登録します。get_article で本文を読み、明示されている事実だけを1文ずつ渡してください。登録した候補は、管理画面で本人が確認するまでサイトには出ません。まだ知識のない記事は list_articles_without_knowledge で分かります。",
    tool: { name: "propose_travel_facts", title: "Propose travel facts" },
    target,
  }),
  "knowledge.backlog": operation<KnowledgeBacklogDto>()({
    kind: "read",
    surface: "operator",
    input: v.object({}),
    description: "「旅の知識」がまだない公開記事の一覧と、済んだ本数・残りの本数を返します。",
    tool: { name: "list_articles_without_knowledge", title: "List articles without knowledge" },
    target: { type: "knowledge" },
  }),
  "knowledge.pending": operation<{ items: readonly PendingFactDto[] }>()({
    kind: "read",
    surface: "operator",
    input: v.object({}),
    description: "本人の確認を待っている事実の候補を、記事をまたいで一覧します。",
    tool: { name: "list_pending_facts", title: "List pending facts" },
    target: { type: "knowledge" },
  }),
  "knowledge.reviewFact": operation<{ fact: TravelFactDto | null }>()({
    kind: "write",
    surface: "admin-only",
    input: v.object({
      factId: id,
      decision: v.literalUnion(["verify", "reject"] as const),
    }),
    description:
      "事実の候補を確認済みにする（verify）か、却下して消す（reject）。管理画面で本人だけが行えます。",
    target: { type: "knowledge", idField: "factId" },
  }),
};
