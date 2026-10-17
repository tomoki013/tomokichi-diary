import type { PublicMonetization } from "@tomokichi/contracts";
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
        experiment:
          c.enabled &&
          e &&
          c.articleId === "52b1cb6d-eb74-85a3-b6a1-392f83313051" &&
          e.id === "chagee-placement-v1" &&
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
