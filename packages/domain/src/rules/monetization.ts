import type {
  AdExperiment,
  ArticleMonetization,
  MonetizationSettings,
  PublicMonetization,
} from "@tomokichi/contracts";
import type { DomainError } from "../primitives/result.js";
export type {
  AdExperiment,
  AffiliateOffer,
  ArticleMonetization,
  MonetizationPlacement,
  MonetizationSettings,
  PublicMonetization,
} from "@tomokichi/contracts";

export const AFFILIATE_ENABLED = false;
// A future release must implement an approved public projection and renderer.
export const AFFILIATE_RELEASE_APPROVED = false;
export const DEFAULT_MONETIZATION_SETTINGS: MonetizationSettings = {
  adsEnabled: true,
  placementsEnabled: false,
  experimentsEnabled: false,
  affiliateEnabled: false,
  maxAds: 1,
  adUnits: [{ id: "7152502134", name: "記事末尾 300×250" }],
  updatedAt: null,
};
export function defaultArticleMonetization(): ArticleMonetization {
  return {
    mode: "ads",
    adsEnabled: true,
    maxAds: 1,
    experimentId: null,
    placements: [
      {
        key: "article-end",
        kind: "adsense",
        position: "article_end",
        status: "ready",
        adUnit: "7152502134",
        offerId: null,
      },
    ],
    updatedAt: null,
  };
}
export function monetizationMarkers(markdown: string): { key: string; offset: number }[] {
  // Fenced and indented code are never eligible placement positions.
  const withoutCode = markdown.replace(
    /^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\2[^\n]*$/gm,
    (m) => m.replace(/[^\n]/g, " "),
  );
  return [...withoutCode.matchAll(/^\{\{monetization:([a-z0-9]+(?:-[a-z0-9]+)*)\}\}[ \t]*$/gm)].map(
    (m) => ({ key: m[1]!, offset: m.index! }),
  );
}
/** Conservative authoring guard; runtime additionally checks viewport and neighbouring UI. */
export function validateMonetization(
  config: ArticleMonetization,
  markdown: string,
  settings: MonetizationSettings,
): DomainError[] {
  const errors: DomainError[] = [];
  const reject = (message: string) =>
    errors.push({ code: "MONETIZATION_INVALID", message, field: "monetization" });
  const markers = monetizationMarkers(markdown);
  const keys = markers.map((m) => m.key);
  if (new Set(keys).size !== keys.length) reject("本文の収益化マーカーが重複しています");
  if (new Set(config.placements.map((p) => p.key)).size !== config.placements.length)
    reject("配置キーが重複しています");
  if (config.maxAds !== 1) reject("広告は1記事1枠までです");
  const ads = config.placements.filter((p) => p.kind === "adsense" && p.status === "ready");
  if (ads.length > 1) reject("有効なAdSense配置は1枠までです");
  for (const p of config.placements) {
    if (p.kind === "adsense" && !settings.adUnits.some((u) => u.id === p.adUnit))
      reject("未登録の広告ユニットです");
    if (p.position !== "marker") continue;
    const marker = markers.find((m) => m.key === p.key);
    if (!marker) {
      reject(`配置 ${p.key} のマーカーがありません。自動移動はしません`);
      continue;
    }
    if (p.kind !== "adsense" || p.status !== "ready") continue;
    const before = markdown.slice(0, marker.offset);
    const after = markdown.slice(marker.offset + `{{monetization:${p.key}}}`.length);
    if (before.replace(/\s/g, "").length < 600 || !/^## /m.test(before))
      reject(`配置 ${p.key} は導入文から十分に離してください（見出しと本文600字以上）`);
    const adjacent = `${
      before
        .trim()
        .split(/\n\s*\n/)
        .at(-1) ?? ""
    }\n${after.trim().split(/\n\s*\n/)[0] ?? ""}`;
    if (/!\[|\{\{embed:|^\s*\[.+\]\(/m.test(adjacent))
      reject(`配置 ${p.key} は画像・ギャラリー・関連リンクから離してください`);
  }
  return errors;
}
export function publicMonetization(
  articleId: string,
  config: ArticleMonetization,
  settings: MonetizationSettings,
  experiment: AdExperiment | null,
): PublicMonetization {
  const enabled =
    settings.adsEnabled && config.adsEnabled && ["ads", "hybrid"].includes(config.mode);
  const selected = config.placements.find((p) => p.kind === "adsense" && p.status === "ready");
  const stopped = config.experimentId && experiment?.status === "stopped";
  const placement =
    stopped && enabled
      ? { key: "article-end", position: "article_end" as const, adUnit: experiment.adUnitA }
      : !enabled
        ? null
        : !settings.placementsEnabled
          ? { key: "article-end", position: "article_end" as const, adUnit: "7152502134" }
          : selected
            ? { key: selected.key, position: selected.position, adUnit: selected.adUnit }
            : null;
  return {
    articleId,
    enabled,
    placement,
    experiment:
      enabled &&
      settings.placementsEnabled &&
      settings.experimentsEnabled &&
      experiment?.status === "running" &&
      experiment.articleId === articleId &&
      config.experimentId === experiment.id
        ? {
            id: experiment.id,
            markerKey: experiment.markerKey,
            adUnitA: experiment.adUnitA,
            adUnitB: experiment.adUnitB,
            shareB: experiment.shareB,
          }
        : null,
  };
}
/** Pure, page-scoped randomisation. No storage, cookie or visitor identifier. */
export function assignAdVariant(shareB: number, random: number): "A" | "B" {
  return Number.isFinite(random) && random >= 0 && random < 1 && random * 100 < shareB ? "B" : "A";
}
