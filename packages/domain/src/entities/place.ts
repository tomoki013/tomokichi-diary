import type { LocationId, PlaceId } from "../primitives/id.js";
import type { Slug } from "../primitives/slug.js";

export const PLACE_KINDS = [
  "restaurant",
  "cafe",
  "shop",
  "hotel",
  "airport",
  "station",
  "attraction",
  "landmark",
  "other",
] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

export const PLACE_STATUSES = [
  "open",
  "temporarily_closed",
  "permanently_closed",
  "unknown",
] as const;
export type PlaceStatus = (typeof PLACE_STATUSES)[number];

export interface Place {
  readonly id: PlaceId;
  readonly slug: Slug;
  readonly locationId: LocationId;
  readonly kind: PlaceKind;
  readonly name: string;
  readonly address: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly officialUrl: string | null;
  readonly status: PlaceStatus;
}
