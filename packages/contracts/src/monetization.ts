import { v, type Validator } from "./validation.js";

export interface MonetizationSettings {
  adsEnabled: boolean;
  placementsEnabled: boolean;
  experimentsEnabled: boolean;
  affiliateEnabled: false;
  maxAds: 1;
  adUnits: { id: string; name: string }[];
  updatedAt: string | null;
}
export interface MonetizationPlacement {
  key: string;
  kind: "adsense" | "affiliate";
  position: "article_end" | "marker";
  status: "ready" | "paused";
  adUnit: string;
  offerId: string | null;
}
export interface ArticleMonetization {
  mode: "none" | "ads" | "affiliate" | "hybrid";
  adsEnabled: boolean;
  maxAds: 1;
  experimentId: string | null;
  placements: MonetizationPlacement[];
  updatedAt: string | null;
}
export interface AffiliateOffer {
  id: string;
  name: string;
  provider: string;
  category: string;
  heading: string;
  description: string;
  imageUrl: string | null;
  url: string | null;
  format: "text" | "booking_card" | "photo_card";
  notes: string;
  status: "draft" | "ready" | "paused" | "archived";
  checkedAt: string | null;
  updatedAt: string | null;
}
export interface AdExperiment {
  id: string;
  articleId: string;
  name: string;
  markerKey: string;
  adUnitA: string;
  adUnitB: string;
  shareB: number;
  status: "draft" | "running" | "stopped";
  startedAt: string | null;
  stoppedAt: string | null;
  updatedAt: string | null;
}
/** Explicit public allowlist. No offer ids, labels, URLs, notes or affiliate placements. */
export interface PublicMonetization {
  articleId: string;
  enabled: boolean;
  placement: { key: string; position: "article_end" | "marker"; adUnit: string } | null;
  experiment: {
    id: string;
    markerKey: string;
    adUnitA: string;
    adUnitB: string;
    shareB: number;
  } | null;
}
export interface ArticleMonetizationDto {
  draft: ArticleMonetization;
  published: PublicMonetization | null;
  needsPublication: boolean;
}
const key = v.string({ min: 1, max: 64, pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ });
const id = v.string({ min: 1, max: 100, pattern: /^[A-Za-z0-9_-]+$/ });
const unit = v.string({ min: 1, max: 20, pattern: /^\d+$/ });
const timestamp = v.nullable(
  v.string({ max: 30, pattern: /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/ }),
);
const safeUrl: Validator<string | null> = (value, path) => {
  if (value === null || value === "" || value === undefined) return { value: null, issues: [] };
  try {
    if (typeof value !== "string" || value.length > 2048) throw new Error();
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !url.hostname.includes(".") ||
      url.port
    )
      throw new Error();
    return { value: url.href, issues: [] };
  } catch {
    return { issues: [{ path, message: "認証情報を含まないHTTPS URLを入力してください" }] };
  }
};
export const placementSchema = v.object({
  key,
  kind: v.literalUnion(["adsense", "affiliate"]),
  position: v.literalUnion(["article_end", "marker"]),
  status: v.literalUnion(["ready", "paused"]),
  adUnit: v.optional(unit, "7152502134"),
  offerId: v.nullable(id),
});
export const articleMonetizationSchema: Validator<ArticleMonetization> = v.object({
  mode: v.literalUnion(["none", "ads", "affiliate", "hybrid"]),
  adsEnabled: v.boolean(),
  maxAds: v.number({ min: 1, max: 1, integer: true }),
  experimentId: v.nullable(key),
  placements: v.array(placementSchema, { max: 30 }),
  updatedAt: v.optional(timestamp, null),
}) as Validator<ArticleMonetization>;
const falseOnly: Validator<false> = (value, path) =>
  value === false
    ? { value: false, issues: [] }
    : { issues: [{ path, message: "このリリースではアフィリエイトは無効です" }] };
export const monetizationSettingsSchema = v.object({
  adsEnabled: v.boolean(),
  placementsEnabled: v.boolean(),
  experimentsEnabled: v.boolean(),
  affiliateEnabled: falseOnly,
  maxAds: v.number({ min: 1, max: 1, integer: true }),
  adUnits: v.array(v.object({ id: unit, name: v.string({ min: 1, max: 100 }) }), { max: 10 }),
  updatedAt: v.optional(timestamp, null),
}) as Validator<MonetizationSettings>;
export const affiliateOfferSchema: Validator<AffiliateOffer> = v.object({
  id,
  name: v.string({ min: 1, max: 150 }),
  provider: v.string({ max: 100 }),
  category: v.string({ max: 80 }),
  heading: v.string({ max: 200 }),
  description: v.string({ max: 2000 }),
  imageUrl: safeUrl,
  url: safeUrl,
  format: v.literalUnion(["text", "booking_card", "photo_card"]),
  notes: v.string({ max: 4000 }),
  status: v.literalUnion(["draft", "ready", "paused", "archived"]),
  checkedAt: timestamp,
  updatedAt: v.optional(timestamp, null),
});
export const adExperimentSchema: Validator<AdExperiment> = v.object({
  id: key,
  articleId: id,
  name: v.string({ min: 1, max: 150 }),
  markerKey: key,
  adUnitA: unit,
  adUnitB: unit,
  shareB: v.number({ min: 10, max: 90, integer: true }),
  status: v.literalUnion(["draft", "running", "stopped"]),
  startedAt: timestamp,
  stoppedAt: timestamp,
  updatedAt: v.optional(timestamp, null),
});
export interface MonetizationOverviewDto {
  publishedAdArticles: number;
  settings: MonetizationSettings;
  articles: { articleId: string; config: ArticleMonetization }[];
  offers: AffiliateOffer[];
  experiments: AdExperiment[];
}
