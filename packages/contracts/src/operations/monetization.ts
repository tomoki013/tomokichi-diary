import {
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
import type { SitePublicationStatus } from "../publication.js";
import { v } from "../validation.js";
import { articleId, id } from "./fields.js";
import { operation } from "./spec.js";

const target = { type: "ad", idField: "articleId" } as const;

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
      "収益化の全体設定、記事ごとの広告配置、アフィリエイト案件、旧位置テストの履歴を返します。",
    tool: { name: "get_monetization", title: "Get monetization overview" },
    target: { type: "ad" },
  }),
  "ads.saveSettings": operation<
    MonetizationSettings & { publication?: SitePublicationStatus | null }
  >()({
    kind: "write",
    surface: "operator",
    input: v.object({ settings: monetizationSettingsSchema }),
    description:
      "収益化の全体設定を保存します。アンカー広告テストは anchorExperimentEnabled で切り替えます。広告全体またはアンカーテストを切り替えると公開済みの記事からサイトを再生成します。変更しない項目は get_monetization の settings の値を渡してください。",
    tool: { name: "save_monetization_settings", title: "Save monetization settings" },
    target: { type: "ad" },
  }),
  "ads.article": operation<ArticleAdsDto>()({
    kind: "read",
    surface: "operator",
    input: v.object({ articleId }),
    description:
      "記事の広告設定と公開版の設定、旧位置テストの履歴、登録済みの広告ユニットを返します。",
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
        v.literalUnion(["standard", "none"] as const),
        "standard（本文中に置ける段落があれば本文中＋末尾、短い記事は末尾のみ）、none（広告なし）",
      ),
    }),
    description:
      "公開中の記事の広告を標準配置または広告なしに揃えて下書き保存します。標準配置は本文に置ける段落があれば本文中と末尾に表示します。記事単位での変更の公開には publish_article を使います。",
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
      "公開チェックで位置の調整が必要な収益化マーカーを適切な段落へ移して下書き保存します。公開は publish_article。",
    tool: { name: "move_body_ad", title: "Move body ad" },
    target,
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
