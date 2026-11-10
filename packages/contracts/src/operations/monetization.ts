import {
  adExperimentSchema,
  affiliateOfferSchema,
  articleMonetizationSchema,
  monetizationSettingsSchema,
  type AdExperiment,
  type AffiliateOffer,
  type ArticleMonetization,
  type MonetizationOverviewDto,
  type MonetizationSettings,
  type PublicMonetization,
} from "../monetization.js";
import { v } from "../validation.js";
import { articleId, id } from "./fields.js";
import { operation } from "./spec.js";

const target = { type: "ad", idField: "articleId" } as const;
const unit = v.string({ min: 1, max: 20, pattern: /^\d+$/ });

/** One article's ads: what is saved, what readers get, and its tests. */
export interface ArticleAdsDto {
  readonly adUnits: readonly { id: string; name: string }[];
  readonly draft: ArticleMonetization;
  readonly published: PublicMonetization | null;
  readonly needsPublication: boolean;
  readonly experiments: readonly AdExperiment[];
}
export interface AdProblemDto {
  readonly code: string;
  readonly field?: string | null;
  readonly message: string;
}

export const monetizationOperations = {
  "ads.overview": operation<MonetizationOverviewDto>()({
    kind: "read",
    surface: "operator",
    input: v.object({}),
    description:
      "収益化の全体像: 全体設定（広告の入切、広告ユニット）、記事ごとの広告配置、アフィリエイト案件、A/Bテストの一覧。",
    tool: { name: "get_monetization", title: "Get monetization overview" },
    target: { type: "ad" },
  }),
  "ads.saveSettings": operation<MonetizationSettings>()({
    kind: "write",
    surface: "operator",
    input: v.object({ settings: monetizationSettingsSchema }),
    description:
      "収益化の全体設定（広告・配置・A/Bテスト・アフィリエイトの入切、広告ユニットの一覧）を保存します。現在の値は get_monetization の settings で確認し、変える項目以外はそのまま渡します。",
    tool: { name: "save_monetization_settings", title: "Save monetization settings" },
    target: { type: "ad" },
  }),
  "ads.article": operation<ArticleAdsDto>()({
    kind: "read",
    surface: "operator",
    input: v.object({ articleId }),
    description:
      "記事の広告設定（本文中・末尾の配置、公開中の内容、A/Bテスト）と、サイトに登録済みの広告ユニット一覧を返します。",
    tool: { name: "get_article_ads", title: "Get article ads" },
    target,
  }),
  "ads.saveArticle": operation<ArticleMonetization>()({
    kind: "write",
    surface: "operator",
    input: v.object({ articleId, config: articleMonetizationSchema }),
    description:
      "記事の広告配置を細かく指定して保存します（アフィリエイト枠を置くときなど）。広告を標準の形に揃えるだけなら set_ad_layout を使ってください。公開は publish_article。",
    tool: { name: "save_article_ads", title: "Save article ads" },
    target,
  }),
  "ads.validateArticle": operation<{ problems: readonly AdProblemDto[] }>()({
    kind: "read",
    surface: "operator",
    input: v.object({ articleId }),
    description: "記事の広告配置が公開ルールに合っているかを確認します。",
    tool: { name: "check_article_ads", title: "Check article ads" },
    target,
  }),
  "ads.setLayout": operation<{ changes: readonly string[]; hasUnpublishedChanges: boolean }>()({
    kind: "write",
    surface: "operator",
    input: v.object({
      articleId,
      layout: v.describe(
        v.literalUnion(["standard", "end-only"] as const),
        "standard（末尾＋本文中）か end-only（末尾のみ）",
      ),
    }),
    description:
      "管理画面の「広告配置」と同じ規則で、公開中の記事の広告を「standard（末尾＋本文中）」か「end-only（末尾のみ）」に揃えて下書き保存します。本文に置ける段落がなければ末尾のみになります。動いているA/Bテストは終了します。公開は publish_article。",
    tool: { name: "set_ad_layout", title: "Set ad layout", destructive: true },
    target,
  }),
  "ads.moveBodyAds": operation<{
    moved: readonly { key: string; after: string }[];
    unmovable: readonly string[];
  }>()({
    kind: "write",
    surface: "operator",
    input: v.object({ articleId }),
    description:
      "公開チェックで「導入文から離して」「画像・関連リンクから離して」と言われた本文中の収益化マーカーを、管理画面の広告標準と同じ選び方の段落へ移して下書き保存します。本文の文章は変えません。A/Bテスト中の記事もテストは続きます。公開は publish_article。",
    tool: { name: "move_body_ad", title: "Move body ad" },
    target,
  }),
  "ads.startTest": operation<{ experimentId: string; hasUnpublishedChanges: boolean }>()({
    kind: "write",
    surface: "operator",
    input: v.object({
      articleId,
      adUnitA: v.maybe(unit),
      adUnitB: v.maybe(unit),
      shareB: v.describe(
        v.maybe(v.number({ integer: true, min: 10, max: 90 })),
        "Bを見せる割合（%）。省くと50",
      ),
      afterText: v.describe(
        v.maybe(v.string({ min: 2, max: 140 })),
        "末尾がこの文を含む段落の後をBの位置にする",
      ),
    }),
    description:
      "管理画面の「広告テスト」と同じ規則で、公開中の記事に本文中の広告の位置のA/Bテストを作って開始し、下書き保存します。A・Bとも記事末尾の広告あり、Aは今の本文中の位置、Bは別の段落。afterText を渡すと、末尾がその文を含む段落の後をBにします（公開ルールに合う段落だけ）。省くとAから離れた段落を自動で選びます。ユニットを省くと登録済みの最初のユニット。公開は publish_article。",
    tool: { name: "start_ad_test", title: "Start ad test" },
    target,
  }),
  "ads.saveExperiment": operation<AdExperiment>()({
    kind: "write",
    surface: "operator",
    input: v.object({ experiment: adExperimentSchema }),
    description:
      "A/Bテストの設定を細かく指定して保存します。ふつうは start_ad_test を使ってください。",
    tool: { name: "save_ad_experiment", title: "Save ad experiment" },
    target: { type: "ad" },
  }),
  "ads.controlExperiment": operation<AdExperiment>()({
    kind: "write",
    surface: "operator",
    input: v.object({
      experimentId: id,
      action: v.literalUnion(["start", "stop"] as const),
    }),
    description:
      "A/Bテストを開始（start）または終了（stop）します。終了したテストは再開できません。",
    tool: { name: "control_ad_experiment", title: "Start or stop ad experiment" },
    target: { type: "ad", idField: "experimentId" },
  }),
  "offer.create": operation<AffiliateOffer>()({
    kind: "write",
    surface: "operator",
    input: v.object({ offer: v.unknown() }),
    description:
      "アフィリエイト案件を登録します。offer には name, provider, category, heading, description, imageUrl, url, format（text / booking_card / photo_card）, notes, status（draft / ready / paused）, checkedAt, publicationApproved を渡します（id は自動）。",
    tool: { name: "create_affiliate_offer", title: "Create affiliate offer" },
    target: { type: "ad" },
  }),
  "offer.update": operation<AffiliateOffer>()({
    kind: "write",
    surface: "operator",
    input: v.object({ offer: affiliateOfferSchema }),
    description:
      "アフィリエイト案件を更新します。現在の内容は get_monetization の offers で確認し、変える項目以外はそのまま渡します。",
    tool: { name: "update_affiliate_offer", title: "Update affiliate offer" },
    target: { type: "ad" },
  }),
  "offer.archive": operation<AffiliateOffer>()({
    kind: "delete",
    surface: "operator",
    input: v.object({ offerId: id }),
    description:
      "アフィリエイト案件を一覧から外します（保管扱い。既存の配置は残ります）。管理画面からだけ実行できます。",
    target: { type: "ad", idField: "offerId" },
  }),
};
