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
  readonly kind: "article" | "page" | "note";
  readonly slug: string;
  readonly title: string;
  readonly status: string;
  readonly locale: string;
  readonly path: string | null;
  readonly publishedAt: string | null;
  /** When a `scheduled` article goes live. */
  readonly scheduledAt: string | null;
  readonly updatedAt: string;
  /**
   * When the title, summary, SEO text or body last changed in the current
   * revision's history; ad marker moves, ad, tag and series edits do not count.
   * Null where the list does not compute it.
   */
  readonly contentUpdatedAt?: string | null;
  /** Formal D1 memberships and taxonomy relations, included in admin lists. */
  readonly collectionIds?: readonly string[];
  readonly categoryIds?: readonly string[];
  readonly locationIds?: readonly string[];
  readonly hasUnpublishedChanges: boolean;
  readonly isLive: boolean;
  readonly noindex: boolean;
}

/** `GET /v1/admin/likes`. Article titles are joined on the client from the article list. */
export interface LikeActivityDto {
  readonly total: number;
  readonly visitors: number;
  readonly articles: readonly {
    readonly articleId: string;
    readonly count: number;
    readonly lastLikedAt: string;
  }[];
  readonly recent: readonly { readonly articleId: string; readonly createdAt: string }[];
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
  /** Identifiers from the domain's experience vocabulary; labels are the client's. */
  readonly experienceTags: readonly string[];
  readonly media: readonly ArticleMediaDto[];
  readonly relations: ArticleRelationsDto;
  readonly collectionIds: readonly string[];
  /** Travel articles explicitly linked from a diary note. */
  readonly relatedArticleIds?: readonly string[];
}

export interface ArticleMediaDto {
  readonly mediaId: string;
  readonly url: string;
  /** The URLs the current draft body shows this photo by; empty when it is not in the body. */
  readonly bodyUrls?: readonly string[];
  readonly thumbnailUrl?: string | null;
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
  readonly originalName: string | null;
  readonly slug: string | null;
  /** Made by an image model; kept out of the gallery. */
  readonly aiGenerated: boolean;
  readonly hashVerified: boolean;
  readonly slugUrl: string | null;
  /**
   * The smallest build derivative, for lists. Exists once a publication has
   * built it; clients fall back to `url` when it fails to load.
   */
  readonly thumbnailUrl?: string | null;
}

/** One page of the media library, searched on the server. */
export interface MediaPageDto {
  readonly items: readonly MediaAssetDto[];
  readonly total: number;
  readonly nextOffset: number | null;
}

/** Keeps the existing upload response fields for older admin clients. */
export interface MediaUploadDto extends MediaAssetDto {
  readonly duplicate: boolean;
}

export interface MediaHashStatusDto {
  readonly total: number;
  readonly verified: number;
  readonly pending: number;
  readonly uploads: number;
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
    /** Added to an article when it joins this collection in the editor. */
    readonly articleDefaults: CollectionArticleDefaultsDto;
  }[];
}

export interface CollectionArticleDefaultsDto {
  readonly tagIds: readonly string[];
  readonly categoryIds: readonly string[];
  readonly experienceTags: readonly string[];
}

/** Theme music as stored: the share URL and label, never player markup. */
export interface CollectionThemeMusicDto {
  readonly provider: "apple_music";
  readonly url: string;
  readonly title: string | null;
  readonly enabled: boolean;
}

/** A series or journey as the admin manages it. */
export interface CollectionAdminDto {
  readonly id: string;
  readonly slug: string;
  readonly kind: "series" | "journey";
  readonly title: string;
  readonly description: string | null;
  readonly coverMediaId: string | null;
  readonly coverUrl: string | null;
  readonly sortOrder: number;
  readonly path: string | null;
  /** Members whose article is live on the site; zero keeps the page noindex. */
  readonly publishedCount: number;
  readonly memberCount: number;
  readonly themeMusic: CollectionThemeMusicDto | null;
  readonly articleDefaults: CollectionArticleDefaultsDto;
  /** What most members already carry, offered as a starting point for the defaults. */
  readonly suggestedDefaults: CollectionArticleDefaultsDto;
  /** Last saved in the admin; compared with the site's last deploy. */
  readonly updatedAt: string | null;
}

/** A home-page ranking as the admin edits it. */
export interface RankingAdminDto {
  readonly id: string;
  readonly title: string;
  readonly note: string;
  readonly experienceTag: string | null;
  readonly photo: RankingPhotoDto | null;
  readonly sortOrder: number;
  /** First is #1. */
  readonly picks: readonly RankingPickDto[];
  /** How many picks the site would show now; zero keeps the ranking off the page. */
  readonly liveCount: number;
  /** Last saved in the admin; compared with the site's last deploy. */
  readonly updatedAt: string | null;
}

export interface RankingPhotoDto {
  readonly mediaId: string;
  readonly url: string;
  readonly thumbnailUrl: string | null;
  readonly label: string;
}

export interface RankingPickDto {
  readonly articleId: string;
  readonly comment: string;
  readonly slug: string;
  readonly title: string;
  /** Only published articles appear on the site; others are kept but skipped. */
  readonly live: boolean;
}

export interface TagDto {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
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
}

// --- Inquiries (the shared inquiry platform, narrowed to this site) ---------

/** Whether the admin can reach the platform, and why not when it cannot. */
export interface InquiryStatusDto {
  /** The API has an origin and a service token for the platform. */
  readonly configured: boolean;
  /** This site is registered as a project on the platform. */
  readonly registered: boolean;
  /** The platform can send mail, so replies are possible. */
  readonly mailConfigured: boolean;
  /** The contact lanes (動線) a ticket can belong to, in the form's order. */
  readonly lanes: readonly InquiryLaneDto[];
}

/** A contact lane: how a kind of message is handled (`general`, `media`). */
export interface InquiryLaneDto {
  readonly key: string;
  readonly label: string;
}

/** The signature the platform puts under this site's replies. */
export interface InquirySignatureDto {
  readonly signature: string;
  /** No signature of its own: replies are signed with the deployment's. */
  readonly usesDefault: boolean;
}

export type InquiryTicketStatus =
  | "NEW"
  | "TRIAGE"
  | "ACKNOWLEDGED"
  | "IN_PROGRESS"
  | "WAITING_CUSTOMER"
  | "WAITING_INTERNAL"
  | "RESOLVED"
  | "CLOSED";

export interface InquiryTicketSummaryDto {
  readonly id: string;
  /** Human-facing, e.g. `TK-000123`. */
  readonly number: string;
  readonly status: InquiryTicketStatus;
  readonly subject: string;
  /**
   * The lane the subject's topic belongs to; null for a subject no topic
   * names (a ticket that did not come from the form).
   */
  readonly lane: string | null;
  readonly requesterEmail: string | null;
  readonly priority: string;
  readonly slaState: "OK" | "AT_RISK" | "BREACHED";
  readonly nextAction: string | null;
  readonly nextActionAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type InquiryTimelineItemDto =
  | {
      readonly kind: "message";
      readonly id: string;
      /** `note` is an internal note: never sent, never shown to the sender. */
      readonly direction: "inbound" | "outbound" | "note";
      readonly sender: string | null;
      readonly body: string;
      readonly createdAt: string;
    }
  | {
      readonly kind: "event";
      readonly id: string;
      readonly type: string;
      readonly createdAt: string;
    };

export interface InquiryTicketDetailDto extends InquiryTicketSummaryDto {
  /** The reader's own reference for the conversation, opaque unlike `number`. */
  readonly receiptId: string | null;
  /** Optimistic lock: every change sends back the revision it was based on. */
  readonly revision: number;
  readonly resolution: string | null;
  readonly acknowledgedAt: string | null;
  readonly resolvedAt: string | null;
  readonly closedAt: string | null;
  /** Where the platform allows this ticket to move next. */
  readonly allowedStatuses: readonly InquiryTicketStatus[];
  /** A reply needs a mail thread and a sender address. */
  readonly canReply: boolean;
  readonly timeline: readonly InquiryTimelineItemDto[];
  readonly totalTimeline: number;
}

/** Every ticket, counted the ways the inbox filters them. */
export interface InquiryCountsDto {
  readonly all: number;
  /** Not resolved or closed. */
  readonly open: number;
  /** Arrived and not yet looked at. */
  readonly new: number;
  /** Open and past the platform's response target. */
  readonly overdue: number;
  /** Open, by lane key. */
  readonly openByLane: Readonly<Record<string, number>>;
  readonly byStatus: Readonly<Partial<Record<InquiryTicketStatus, number>>>;
}

export interface InquiryTicketPageDto extends PageDto<InquiryTicketSummaryDto> {
  readonly counts: InquiryCountsDto;
}

/** What a reply to one ticket will look like, before anything is written. */
export interface InquiryComposeDto {
  readonly to: string | null;
  readonly from: string;
  /**
   * The subject the reply goes out with. Only the first reply to a form
   * message chooses one; after that the platform keeps the conversation's
   * `Re:` subject and `subjectEditable` is false.
   */
  readonly subject: string;
  readonly subjectEditable: boolean;
  /** The greeting, filled in for this reader, that a new reply starts with. */
  readonly opening: string;
  readonly openings: Readonly<Record<"takagi" | "tomokichi", string>>;
  /** Added by the platform under every reply, above the signature. */
  readonly closing: string;
  readonly signature: string;
}

/** A reply template of this site's, kept on the platform. */
export interface InquiryReplyTemplateDto {
  readonly id: string;
  /** `opening` is put in front of every new reply; the rest are picked. */
  readonly role: "opening" | "reply";
  readonly name: string;
  /** The reply's subject; null uses the platform's default. */
  readonly subject: string | null;
  /** May contain `{{userName}}`, `{{appName}}` and `{{supportUrl}}`. */
  readonly body: string;
  readonly isActive: boolean;
  readonly sortOrder: number;
  readonly updatedAt: string;
}

/** A template filled in for one ticket, ready to edit and send. */
export interface InquiryAppliedTemplateDto {
  readonly body: string;
  /** The template's subject; null when it has none or the subject is fixed. */
  readonly subject: string | null;
  /** Placeholders still standing; a reply containing any is refused. */
  readonly unresolved: readonly string[];
}
