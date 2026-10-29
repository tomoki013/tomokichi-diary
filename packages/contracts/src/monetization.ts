import { v, type Validator } from "./validation.js";

export interface MonetizationSettings {
  adsEnabled: boolean;
  placementsEnabled: boolean;
  experimentsEnabled: boolean;
  affiliateEnabled: boolean;
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
  publicationApproved?: boolean;
  updatedAt: string | null;
}
export interface AdExperiment {
  id: string;
  articleId: string;
  name: string;
  /** B's body ad. */
  markerKey: string;
  /**
   * A's body ad, at a different place from B's: the test compares where the
   * body ad goes, and both arms keep the article-end ad. Null in tests from
   * before position tests, where A had no body ad.
   */
  markerKeyA?: string | null;
  adUnitA: string;
  adUnitB: string;
  shareB: number;
  status: "draft" | "running" | "stopped";
  startedAt: string | null;
  stoppedAt: string | null;
  updatedAt: string | null;
}
export interface PublicAffiliatePlacement {
  key: string;
  position: "article_end" | "marker";
  provider: string;
  heading: string;
  description: string;
  url: string;
  format: "text" | "booking_card";
}
/** Public presentation only. Never includes offer IDs, notes or unapproved offers. */
export interface PublicMonetization {
  affiliates?: PublicAffiliatePlacement[];
  articleId: string;
  enabled: boolean;
  /** The article-end ad, or (experiments, and snapshots before inline ads) the one ad. */
  placement: { key: string; position: "article_end" | "marker"; adUnit: string } | null;
  /** An in-body ad shown in addition to the article-end one. Absent in older snapshots. */
  inline?: { key: string; adUnit: string } | null;
  experiment: {
    id: string;
    markerKey: string;
    markerKeyA?: string | null;
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
export const monetizationSettingsSchema = v.object({
  adsEnabled: v.boolean(),
  placementsEnabled: v.boolean(),
  experimentsEnabled: v.boolean(),
  affiliateEnabled: v.boolean(),
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
  publicationApproved: v.optional(v.boolean(), false),
  updatedAt: v.optional(timestamp, null),
});
export const adExperimentSchema: Validator<AdExperiment> = v.object({
  id: key,
  articleId: id,
  name: v.string({ min: 1, max: 150 }),
  markerKey: key,
  markerKeyA: v.optional(v.nullable(key), null),
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

/** Public experiment identifiers are bounded and tied to one internal article, never free text. */
export const LEGACY_AD_EXPERIMENT = "chagee-placement-v1";
export const LEGACY_AD_ARTICLE = "52b1cb6d-eb74-85a3-b6a1-392f83313051";
const articleUuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
/**
 * One article can be tested again after a test ends: rounds after the first
 * carry `-r<n>` (2–99). A finished ID is never reused, so results never mix.
 */
export function adExperimentId(articleId: string, round = 1): string {
  return round > 1 ? `placement-v1-${articleId}-r${round}` : `placement-v1-${articleId}`;
}
const generated =
  /^placement-v1-([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})(?:-r([2-9]|[1-9]\d))?$/;
/** The round of a generated ID (1 for the first), or null for anything else. */
export function adExperimentRound(value: unknown): number | null {
  const match = typeof value === "string" ? generated.exec(value) : null;
  return match ? Number(match[2] ?? 1) : null;
}
export function isAdExperimentId(value: unknown): value is string {
  return value === LEGACY_AD_EXPERIMENT || adExperimentRound(value) !== null;
}
export function isAdExperimentForArticle(value: unknown, articleId: string): value is string {
  if (value === LEGACY_AD_EXPERIMENT) return articleId === LEGACY_AD_ARTICLE;
  const round = adExperimentRound(value);
  return (
    round !== null && articleUuid.test(articleId) && value === adExperimentId(articleId, round)
  );
}

/** Approved network hosts and their tracking-link shapes; never accepts arbitrary redirects. */
export function isAffiliateUrl(provider: string, value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password || u.port) return false;
    if (provider === "Trip.com")
      return (
        (u.hostname === "www.trip.com" && /^\/t\/[A-Za-z0-9]+$/.test(u.pathname)) ||
        (u.hostname === "jp.trip.com" &&
          /^\d+$/.test(u.searchParams.get("Allianceid") ?? "") &&
          /^\d+$/.test(u.searchParams.get("SID") ?? ""))
      );
    if (provider === "Agoda")
      return (
        u.hostname === "www.agoda.com" &&
        u.pathname.toLowerCase() === "/partners/partnersearch.aspx" &&
        /^[1-9]\d*$/.test(u.searchParams.get("cid") ?? "")
      );
    if (
      provider === "Omio" &&
      u.hostname === "omio.sjv.io" &&
      /^\/(?:[A-Za-z0-9]+|c\/\d+\/\d+\/\d+)$/.test(u.pathname)
    ) {
      const target = u.searchParams.get("u");
      if (!target) return true;
      const destination = new URL(target);
      return (
        destination.protocol === "https:" &&
        !destination.username &&
        !destination.password &&
        !destination.port &&
        ["www.omio.com", "www.omio.jp", "www.omio.co.uk"].includes(destination.hostname)
      );
    }
    return false;
  } catch {
    return false;
  }
}
export function isPublicAffiliatePlacement(value: unknown): value is PublicAffiliatePlacement {
  if (!value || typeof value !== "object") return false;
  const p = value as PublicAffiliatePlacement;
  return (
    typeof p.key === "string" &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.key) &&
    p.key.length <= 64 &&
    ["article_end", "marker"].includes(p.position) &&
    ["text", "booking_card"].includes(p.format) &&
    typeof p.heading === "string" &&
    p.heading.trim().length > 0 &&
    p.heading.length <= 200 &&
    typeof p.description === "string" &&
    p.description.length <= 2000 &&
    isAffiliateUrl(p.provider, p.url)
  );
}
