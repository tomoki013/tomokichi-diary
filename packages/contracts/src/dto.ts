/**
 * The shapes crossing the network. Domain entities are never serialised
 * directly, so the public surface can stay stable while the model evolves
 * (instruction §10, §80).
 */
export interface ErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly requestId: string;
    readonly issues?: readonly { readonly path: string; readonly message: string }[];
  };
}

export interface PageDto<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly hasMore: boolean;
}

export interface ArticleSummaryDto {
  readonly id: string;
  readonly kind: "article" | "page";
  readonly slug: string;
  readonly title: string;
  readonly status: string;
  readonly locale: string;
  readonly path: string | null;
  readonly publishedAt: string | null;
  readonly updatedAt: string;
  readonly hasUnpublishedChanges: boolean;
  readonly isLive: boolean;
  readonly noindex: boolean;
}

export interface RevisionDto {
  readonly id: string;
  readonly revisionNumber: number;
  readonly title: string;
  readonly summary: string;
  readonly bodyMarkdown: string;
  readonly seoTitleOverride: string | null;
  readonly seoDescriptionOverride: string | null;
  readonly changeSummary: string | null;
  readonly createdAt: string;
}

export interface ArticleDetailDto extends ArticleSummaryDto {
  readonly currentRevision: RevisionDto | null;
  readonly publishedRevisionId: string | null;
  readonly travelStartDate: string | null;
  readonly travelEndDate: string | null;
  readonly media: readonly ArticleMediaDto[];
  readonly relations: ArticleRelationsDto;
  readonly collectionIds: readonly string[];
}

export interface ArticleMediaDto {
  readonly mediaId: string;
  readonly url: string;
  readonly role: string;
  readonly sortOrder: number;
  readonly alt: string;
  readonly caption: string | null;
  readonly width: number | null;
  readonly height: number | null;
}

export interface ArticleRelationsDto {
  readonly locations: readonly { readonly locationId: string; readonly relation: string }[];
  readonly places: readonly { readonly placeId: string; readonly relation: string }[];
  readonly categoryIds: readonly string[];
  readonly tagIds: readonly string[];
}

export interface MediaAssetDto {
  readonly id: string;
  readonly url: string;
  readonly mimeType: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly size: number;
}

export interface RouteDto {
  readonly path: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly isCanonical: boolean;
  readonly redirectTo: string | null;
  readonly noindex: boolean;
}

export interface LocationDto {
  readonly id: string;
  readonly slug: string;
  readonly type: string;
  readonly parentId: string | null;
  readonly name: string;
}

export interface TaxonomyDto {
  readonly categories: readonly {
    readonly id: string;
    readonly slug: string;
    readonly name: string;
  }[];
  readonly tags: readonly { readonly id: string; readonly slug: string; readonly name: string }[];
  readonly collections: readonly {
    readonly id: string;
    readonly slug: string;
    readonly kind: string;
    readonly title: string;
  }[];
}

export interface PublishCheckDto {
  readonly publishable: boolean;
  readonly problems: readonly {
    readonly code: string;
    readonly field: string | null;
    readonly message: string;
  }[];
}

export interface SourceReferenceDto {
  readonly id: string;
  readonly type: "firsthand-note" | "official" | "external";
  readonly name: string;
  readonly url: string | null;
  readonly checkedAt: string | null;
}

export interface TravelRouteDto {
  readonly id: string;
  readonly name: string;
  readonly mode: "walk" | "bus" | "train" | "car" | "air" | "mixed";
  readonly start: TravelRoutePointDto;
  readonly waypoints: readonly TravelRoutePointDto[];
  readonly end: TravelRoutePointDto;
  readonly durationMinutes: number | null;
  readonly distanceKm: number | null;
  readonly experiencedAt: string | null;
  readonly provenance: "firsthand" | "official" | "researched" | "derived";
  readonly note: string | null;
}

export interface TravelRoutePointDto {
  readonly name: string;
  readonly placeId: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly externalMapUrl: string | null;
}

export interface TravelFactDto {
  readonly id: string;
  readonly kind:
    | "visit"
    | "food_drink"
    | "transport"
    | "cost"
    | "duration"
    | "procedure"
    | "observation"
    | "recommendation"
    | "warning"
    | "current_fact";
  readonly statement: string;
  readonly provenance: "firsthand" | "official" | "researched" | "derived";
  readonly status: "candidate" | "verified";
  readonly experiencedAt: string | null;
  readonly verifiedAt: string | null;
  readonly value: {
    readonly amount: number;
    readonly unit: string | null;
    readonly currency: string | null;
  } | null;
  readonly volatility: "low" | "medium" | "high" | null;
  readonly articleIds: readonly string[];
  readonly placeIds: readonly string[];
  readonly sourceIds: readonly string[];
  readonly travelRouteId: string | null;
  readonly verifiedBy: string | null;
}

export interface ArticleKnowledgeDto {
  readonly articleId: string;
  readonly revisionId: string;
  readonly schemaVersion: 1;
  readonly quickAnswer: { readonly summary: string; readonly recommendation: string | null } | null;
  readonly decisionTable: {
    readonly title: string;
    readonly columns: readonly string[];
    readonly rows: readonly { readonly label: string; readonly values: readonly string[] }[];
  } | null;
  readonly experienceGroups: readonly {
    readonly id: string;
    readonly title: string;
    readonly summary: string;
    readonly factIds: readonly string[];
  }[];
  readonly currentFactIds: readonly string[];
  readonly cautionFactIds: readonly string[];
  readonly routeIds: readonly string[];
  readonly relatedArticles: readonly {
    readonly articleId: string;
    readonly relation:
      "detail" | "recommendation" | "how-to" | "trip-diary" | "location-guide" | "next-step";
  }[];
}

export interface ArticleKnowledgeBundleDto {
  readonly article: ArticleKnowledgeDto | null;
  readonly facts: readonly TravelFactDto[];
  readonly sources: readonly SourceReferenceDto[];
  readonly routes: readonly TravelRouteDto[];
  readonly canSuggestWithAi: boolean;
}
