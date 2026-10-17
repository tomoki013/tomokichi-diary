import { isAdExperimentForArticle, type PublicMonetization } from "@tomokichi/contracts";
import {
  validateMonetization,
  defaultArticleMonetization,
  DEFAULT_MONETIZATION_SETTINGS,
} from "@tomokichi/domain";
export interface AdPlan {
  layout: "article-end-v1" | "article-placement-v2";
  end: { unit: string; variant: "A" | "static" } | null;
  marker: { key: string; unit: string; variant: "B" | "static" } | null;
  experiment: PublicMonetization["experiment"];
}
const legacy = (): AdPlan => ({
  layout: "article-end-v1",
  end: { unit: "7152502134", variant: "static" },
  marker: null,
  experiment: null,
});
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
  const experiment =
    flags.experiments && isAdExperimentForArticle(config.experiment?.id, config.articleId)
      ? config.experiment
      : null;
  if (
    experiment &&
    (!Number.isInteger(experiment.shareB) || experiment.shareB < 10 || experiment.shareB > 90)
  )
    return empty;
  const p = experiment
    ? { key: experiment.markerKey, position: "marker" as const, adUnit: experiment.adUnitB }
    : config.placement;
  if (!p || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.key) || !/^\d{1,20}$/.test(p.adUnit)) return empty;
  const valid = validateMonetization(
    {
      ...defaultArticleMonetization(),
      placements: [{ ...p, kind: "adsense", status: "ready", offerId: null }],
    },
    markdown,
    { ...DEFAULT_MONETIZATION_SETTINGS, adUnits: [{ id: p.adUnit, name: "published" }] },
  );
  if (valid.length) return empty; // Missing/duplicate marker never falls back to another position.
  if (experiment) {
    if (!/^\d{1,20}$/.test(experiment.adUnitA)) return empty;
    return {
      ...empty,
      end: { unit: experiment.adUnitA, variant: "A" },
      marker: { key: p.key, unit: p.adUnit, variant: "B" },
      experiment,
    };
  }
  return p.position === "article_end"
    ? {
        ...empty,
        layout:
          p.key === "article-end" && p.adUnit === "7152502134"
            ? "article-end-v1"
            : "article-placement-v2",
        end: { unit: p.adUnit, variant: "static" },
      }
    : { ...empty, marker: { key: p.key, unit: p.adUnit, variant: "static" } };
}
