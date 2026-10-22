import {
  isPublicAffiliatePlacement,
  isAdExperimentForArticle,
  type PublicMonetization,
} from "@tomokichi/contracts";
const key = (s: unknown): s is string =>
  typeof s === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s) && s.length <= 64;
const unit = (s: unknown): s is string => typeof s === "string" && /^\d{1,20}$/.test(s);

/** Build boundary repeats the allowlist, even if a stored JSON document has extra properties. */
export function publicMonetizationOnly(
  values: readonly PublicMonetization[],
): PublicMonetization[] {
  return values.flatMap((c) => {
    if (!c || typeof c.articleId !== "string" || typeof c.enabled !== "boolean") return [];
    const p = c.placement;
    const e = c.experiment;
    return [
      {
        ...(Array.isArray(c.affiliates) &&
        c.affiliates.length &&
        c.affiliates.length <= 2 &&
        c.affiliates.every(isPublicAffiliatePlacement) &&
        new Set(c.affiliates.map((item) => item.key)).size === c.affiliates.length
          ? {
              affiliates: c.affiliates.map((item) => ({
                key: item.key,
                position: item.position,
                provider: item.provider,
                heading: item.heading,
                description: item.description,
                url: item.url,
                format: item.format,
              })),
            }
          : {}),
        articleId: c.articleId,
        enabled: c.enabled,
        placement:
          c.enabled &&
          p &&
          key(p.key) &&
          ["article_end", "marker"].includes(p.position) &&
          unit(p.adUnit)
            ? { key: p.key, position: p.position, adUnit: p.adUnit }
            : null,
        inline:
          c.enabled && c.inline && key(c.inline.key) && unit(c.inline.adUnit)
            ? { key: c.inline.key, adUnit: c.inline.adUnit }
            : null,
        experiment:
          c.enabled &&
          e &&
          isAdExperimentForArticle(e.id, c.articleId) &&
          key(e.markerKey) &&
          unit(e.adUnitA) &&
          unit(e.adUnitB) &&
          Number.isInteger(e.shareB) &&
          e.shareB >= 10 &&
          e.shareB <= 90
            ? {
                id: e.id,
                markerKey: e.markerKey,
                adUnitA: e.adUnitA,
                adUnitB: e.adUnitB,
                shareB: e.shareB,
              }
            : null,
      },
    ];
  });
}
