import type { ArticleId, MediaId } from "../primitives/id.js";
import type { Brand } from "../primitives/brand.js";
import type { PlainDate } from "../primitives/datetime.js";
import type { Slug } from "../primitives/slug.js";

export type CollectionId = Brand<string, "CollectionId">;

/**
 * An ordered group of articles. Two kinds exist because the site publishes two:
 * editorial `series` and time-bounded `journey` trips. Both keep their own URL
 * space, which is why they are modelled rather than folded into tags.
 */
export const COLLECTION_KINDS = ["series", "journey"] as const;
export type CollectionKind = (typeof COLLECTION_KINDS)[number];

export interface Collection {
  readonly id: CollectionId;
  readonly slug: Slug;
  readonly kind: CollectionKind;
  readonly title: string;
  readonly description: string | null;
  readonly coverMediaId: MediaId | null;
  readonly startDate: PlainDate | null;
  readonly endDate: PlainDate | null;
  readonly sortOrder: number;
}

export interface ArticleCollection {
  readonly articleId: ArticleId;
  readonly collectionId: CollectionId;
  readonly sortOrder: number;
}
