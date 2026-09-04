import type { PlainDate } from "../primitives/datetime.js";
import type {
  ArticleId,
  AuthorId,
  PlaceId,
  RevisionId,
  SourceId,
  TravelFactId,
  TravelRouteId,
} from "../primitives/id.js";

export const PROVENANCE_TYPES = ["firsthand", "official", "researched", "derived"] as const;
export type Provenance = (typeof PROVENANCE_TYPES)[number];

export const FACT_STATUSES = ["candidate", "verified"] as const;
export type TravelFactStatus = (typeof FACT_STATUSES)[number];

export const FACT_KINDS = [
  "visit",
  "food_drink",
  "transport",
  "cost",
  "duration",
  "procedure",
  "observation",
  "recommendation",
  "warning",
  "current_fact",
] as const;
export type TravelFactKind = (typeof FACT_KINDS)[number];

export interface SourceReference {
  readonly id: SourceId;
  readonly type: "firsthand-note" | "official" | "external";
  readonly name: string;
  readonly url: string | null;
  readonly checkedAt: PlainDate | null;
}

export interface TravelRoutePoint {
  readonly name: string;
  readonly placeId: PlaceId | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly externalMapUrl: string | null;
}

export interface TravelRoute {
  readonly id: TravelRouteId;
  readonly name: string;
  readonly mode: "walk" | "bus" | "train" | "car" | "air" | "mixed";
  readonly start: TravelRoutePoint;
  readonly waypoints: readonly TravelRoutePoint[];
  readonly end: TravelRoutePoint;
  readonly durationMinutes: number | null;
  readonly distanceKm: number | null;
  readonly experiencedAt: PlainDate | null;
  readonly provenance: Provenance;
  readonly note: string | null;
}

export interface FactValue {
  readonly amount: number;
  readonly unit: string | null;
  readonly currency: string | null;
}

/** A reusable claim whose time, evidence and verification state are explicit. */
export interface TravelFact {
  readonly id: TravelFactId;
  readonly kind: TravelFactKind;
  readonly statement: string;
  readonly provenance: Provenance;
  readonly status: TravelFactStatus;
  readonly experiencedAt: PlainDate | null;
  readonly verifiedAt: PlainDate | null;
  readonly value: FactValue | null;
  readonly volatility: "low" | "medium" | "high" | null;
  readonly articleIds: readonly ArticleId[];
  readonly placeIds: readonly PlaceId[];
  readonly sourceIds: readonly SourceId[];
  readonly travelRouteId: TravelRouteId | null;
  /** Human identity is mandatory for verified firsthand facts. */
  readonly verifiedBy: AuthorId | null;
}

export interface DecisionTable {
  readonly title: string;
  readonly columns: readonly string[];
  readonly rows: readonly { readonly label: string; readonly values: readonly string[] }[];
}

export interface ArticleKnowledge {
  readonly articleId: ArticleId;
  readonly revisionId: RevisionId;
  readonly schemaVersion: 1;
  readonly quickAnswer: {
    readonly summary: string;
    readonly recommendation: string | null;
  } | null;
  readonly decisionTable: DecisionTable | null;
  readonly experienceGroups: readonly {
    readonly id: string;
    readonly title: string;
    readonly summary: string;
    readonly factIds: readonly TravelFactId[];
  }[];
  readonly currentFactIds: readonly TravelFactId[];
  readonly cautionFactIds: readonly TravelFactId[];
  readonly routeIds: readonly TravelRouteId[];
  readonly relatedArticles: readonly {
    readonly articleId: ArticleId;
    readonly relation:
      "detail" | "recommendation" | "how-to" | "trip-diary" | "location-guide" | "next-step";
  }[];
}
