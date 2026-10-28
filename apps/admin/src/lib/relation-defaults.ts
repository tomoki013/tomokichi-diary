import type { CollectionArticleDefaultsDto, LocationDto } from "@tomokichi/contracts";

/**
 * What the editor fills in for the author once a choice already decides it:
 * joining a series brings that series' defaults, choosing a place brings the
 * tags named after it and whether the trip was in Japan or abroad. Only
 * additions are made here, and only what was not already chosen is reported,
 * so taking the choice back can remove exactly what it brought.
 */
export function addMissing(current: readonly string[], wanted: readonly string[]) {
  const added = wanted.filter((id, index) => !current.includes(id) && wanted.indexOf(id) === index);
  return { next: [...current, ...added], added };
}

/** Removes what an earlier choice added, keeping anything another choice still wants. */
export function removeAdded(
  current: readonly string[],
  added: readonly string[],
  stillWanted: readonly string[] = [],
): string[] {
  return current.filter((id) => !added.includes(id) || stillWanted.includes(id));
}

const DOMESTIC = "国内旅行";
const ABROAD = "海外旅行";

/**
 * Tags a location decides: a tag with the same name as the place or any
 * place above it (サントリーニ, ギリシャ, ヨーロッパ), and 国内旅行 or 海外旅行
 * by whether the place is in Japan. Tags that do not exist are not invented.
 */
export function locationTagIds(
  locationId: string,
  locations: readonly LocationDto[],
  tags: readonly { id: string; name: string }[],
): string[] {
  const byId = new Map(locations.map((location) => [location.id, location]));
  const chain: LocationDto[] = [];
  for (
    let location = byId.get(locationId);
    location && !chain.includes(location);
    location = location.parentId ? byId.get(location.parentId) : undefined
  )
    chain.push(location);
  if (chain.length === 0) return [];
  const names = new Set(chain.map((location) => location.name));
  // Continents and the "global" region say nothing about where the trip was.
  const placed = chain.some(
    (location) => location.type !== "continent" && location.type !== "region",
  );
  const scope = chain.some((location) => location.slug === "japan")
    ? DOMESTIC
    : placed
      ? ABROAD
      : null;
  return tags.filter((tag) => names.has(tag.name) || tag.name === scope).map((tag) => tag.id);
}

export const emptyDefaults: CollectionArticleDefaultsDto = {
  tagIds: [],
  categoryIds: [],
  experienceTags: [],
};
