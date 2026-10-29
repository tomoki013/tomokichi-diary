import {
  isPublicAffiliatePlacement,
  type PublicAffiliatePlacement,
  isAdExperimentForArticle,
  type PublicMonetization,
} from "@tomokichi/contracts";
import {
  validateMonetization,
  defaultArticleMonetization,
  DEFAULT_MONETIZATION_SETTINGS,
} from "@tomokichi/domain";
export interface AdPlan {
  layout: "article-end-v1" | "article-placement-v2";
  end: { unit: string; variant: "static" } | null;
  marker: { key: string; unit: string; variant: "B" | "static" } | null;
  /** In a position test, A's body ad (B's is `marker`). */
  markerA?: { key: string; unit: string; variant: "A" } | null;
  experiment: PublicMonetization["experiment"];
}
const legacy = (): AdPlan => ({
  layout: "article-end-v1",
  end: { unit: "7152502134", variant: "static" },
  marker: null,
  experiment: null,
});
const valid = (p: { key: string; adUnit: string }): boolean =>
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.key) && /^\d{1,20}$/.test(p.adUnit);
/** Revalidate the public snapshot at build time, independently of admin flags. */
export function buildAdPlan(
  config: PublicMonetization | undefined,
  markdown: string,
  flags: { placements: boolean; experiments: boolean } = { placements: true, experiments: true },
): AdPlan {
  if (!config) return legacy();
  const empty: AdPlan = {
    layout: "article-placement-v2",
    end: null,
    marker: null,
    experiment: null,
  };
  if (!config.enabled) return empty;
  if (!flags.placements || (config.experiment && !flags.experiments)) return legacy();
  const candidate =
    flags.experiments && isAdExperimentForArticle(config.experiment?.id, config.articleId)
      ? config.experiment
      : null;
  const markerFits = (p: { key: string; adUnit: string }): boolean =>
    validateMonetization(
      {
        ...defaultArticleMonetization(),
        placements: [{ ...p, position: "marker", kind: "adsense", status: "ready", offerId: null }],
      },
      markdown,
      { ...DEFAULT_MONETIZATION_SETTINGS, adUnits: [{ id: p.adUnit, name: "published" }] },
    ).length === 0;

  // An experiment compares where the body ad goes: both arms keep the end
  // ad, A's body ad is at markerKeyA and B's at markerKey. Older tests have
  // no markerKeyA, and A shows the end ad alone. One that cannot run leaves
  // the article on its end ad.
  const experiment =
    candidate &&
    Number.isInteger(candidate.shareB) &&
    candidate.shareB >= 10 &&
    candidate.shareB <= 90 &&
    /^\d{1,20}$/.test(candidate.adUnitA) &&
    valid({ key: candidate.markerKey, adUnit: candidate.adUnitB }) &&
    markerFits({ key: candidate.markerKey, adUnit: candidate.adUnitB }) &&
    (!candidate.markerKeyA ||
      (candidate.markerKeyA !== candidate.markerKey &&
        valid({ key: candidate.markerKeyA, adUnit: candidate.adUnitA }) &&
        markerFits({ key: candidate.markerKeyA, adUnit: candidate.adUnitA })))
      ? candidate
      : null;
  if (experiment)
    return {
      ...empty,
      end: { unit: experiment.adUnitA, variant: "static" },
      marker: { key: experiment.markerKey, unit: experiment.adUnitB, variant: "B" },
      markerA: experiment.markerKeyA
        ? { key: experiment.markerKeyA, unit: experiment.adUnitA, variant: "A" }
        : null,
      experiment,
    };

  // Every other article: the fixed article-end ad, plus at most one in the
  // body. Snapshots from before inline ads carried a body ad as `placement`.
  const placed = config.placement && valid(config.placement) ? config.placement : null;
  const end =
    placed?.position === "article_end" ? placed : { key: "article-end", adUnit: "7152502134" };
  const inline = config.inline ?? (placed?.position === "marker" ? placed : null);
  const marker = inline && valid(inline) && markerFits(inline) ? inline : null;
  return {
    ...empty,
    layout:
      !marker && end.key === "article-end" && end.adUnit === "7152502134"
        ? "article-end-v1"
        : "article-placement-v2",
    end: { unit: end.adUnit, variant: "static" },
    marker: marker && { key: marker.key, unit: marker.adUnit, variant: "static" },
  };
}

/** Build-time kill switch and independent link/marker validation. No network requests. */
export function buildAffiliatePlan(
  config: PublicMonetization | undefined,
  markdown: string,
  enabled = true,
): PublicAffiliatePlacement[] {
  if (!enabled || !Array.isArray(config?.affiliates) || config.affiliates.length > 2) return [];
  if (!config.affiliates.every(isPublicAffiliatePlacement)) return [];
  if (new Set(config.affiliates.map((p) => p.key)).size !== config.affiliates.length) return [];
  return config.affiliates.filter((p) => {
    if (
      !isPublicAffiliatePlacement(p) ||
      p.key === config.placement?.key ||
      p.key === config.experiment?.markerKey ||
      p.key === config.experiment?.markerKeyA
    )
      return false;
    return (
      validateMonetization(
        {
          ...defaultArticleMonetization(),
          placements: [
            {
              key: p.key,
              kind: "affiliate",
              position: p.position,
              status: "ready",
              offerId: null,
              adUnit: "7152502134",
            },
          ],
        },
        markdown,
        DEFAULT_MONETIZATION_SETTINGS,
      ).length === 0
    );
  });
}
