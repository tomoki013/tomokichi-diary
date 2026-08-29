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
