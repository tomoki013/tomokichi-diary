import {
  ANCHOR_AD_EXPERIMENT,
  DEFAULT_AD_UNIT,
  resolveStandardAdBody,
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
  end: { unit: string } | null;
  marker: { key: string; unit: string } | null;
  markdown: string;
  experiment: typeof ANCHOR_AD_EXPERIMENT | null;
}

/** Apply the site policy to the published revision, including articles without an ad snapshot. */
export function buildAdPlan(
  config: PublicMonetization | undefined,
  markdown: string,
  flags: { placements: boolean; experiments: boolean; adsEnabled?: boolean } = {
    placements: true,
    experiments: true,
  },
): AdPlan {
  const plan: AdPlan = {
    layout: "article-placement-v2",
    end: null,
    marker: null,
    markdown,
    experiment: null,
  };
  if (config?.enabled === false || flags.adsEnabled === false) return plan;
  if (!flags.placements)
    return { ...plan, layout: "article-end-v1", end: { unit: DEFAULT_AD_UNIT } };

  // A published position test can still supply a known-safe slot. Both arms
  // now use the same position and ad unit, independent of that historical test.
  const previous =
    config && isAdExperimentForArticle(config.experiment?.id, config.articleId)
      ? config.experiment
      : null;
  const placement = config?.placement;
  const units = [
    config?.inline,
    placement?.position === "marker" ? placement : null,
    previous?.markerKeyA ? { key: previous.markerKeyA, adUnit: previous.adUnitA } : null,
    previous ? { key: previous.markerKey, adUnit: previous.adUnitB } : null,
  ].filter(
    (slot): slot is { key: string; adUnit: string } => !!slot && /^\d{1,20}$/.test(slot.adUnit),
  );
  const body = resolveStandardAdBody(
    markdown,
    units.map((slot) => slot.key),
    config?.affiliates?.map((slot) => slot.key),
  );
  const endUnit =
    placement?.position === "article_end" && /^\d{1,20}$/.test(placement.adUnit)
      ? placement.adUnit
      : DEFAULT_AD_UNIT;
  return {
    layout: "article-placement-v2",
    end: { unit: endUnit },
    marker: body.markerKey
      ? {
          key: body.markerKey,
          unit: units.find((slot) => slot.key === body.markerKey)?.adUnit ?? endUnit,
        }
      : null,
    markdown: body.markdown,
    experiment: flags.experiments ? ANCHOR_AD_EXPERIMENT : null,
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
