import type { LocationId } from "../primitives/id.js";
import type { Locale } from "../primitives/locale.js";
import type { Slug } from "../primitives/slug.js";

export const LOCATION_TYPES = [
  "continent",
  "country",
  "region",
  "prefecture",
  "state",
  "city",
  "district",
  "area",
] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

/**
 * One table for every geographic level. Hierarchy is `parentId`, so adding a
 * country or a district never adds a table.
 */
export interface Location {
  readonly id: LocationId;
  readonly slug: Slug;
  readonly type: LocationType;
  readonly parentId: LocationId | null;
  /** ISO 3166-1 alpha-2, null for continents. */
  readonly countryCode: string | null;
  /** ISO 3166-2 subdivision, when meaningful. */
  readonly subdivisionCode: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly timezone: string | null;
}

/** Names are per-locale so a new language never touches the Location table. */
export interface LocationName {
  readonly locationId: LocationId;
  readonly locale: Locale;
  readonly name: string;
  readonly shortName: string | null;
  readonly romanizedName: string | null;
}
