import type { ArticleId, CategoryId, MediaId, TagId } from "../primitives/id.js";
import type { Brand } from "../primitives/brand.js";
import type { Instant, PlainDate } from "../primitives/datetime.js";
import type { Slug } from "../primitives/slug.js";
import type { ExperienceTag } from "./experience.js";

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
  /** Optional music a reader can choose to play while reading the series. */
  readonly themeMusic: CollectionThemeMusic | null;
  /** What an article usually carries once it joins; the editor offers these. */
  readonly articleDefaults: CollectionArticleDefaults;
  /** Last edit in the admin; null for records older than the column. */
  readonly updatedAt: Instant | null;
}

/**
 * Music services a series can name. Only Apple Music is wired up; another
 * service is a new value here plus its URL parser and player.
 */
export const THEME_MUSIC_PROVIDERS = ["apple_music"] as const;
export type ThemeMusicProvider = (typeof THEME_MUSIC_PROVIDERS)[number];

/**
 * A share URL and an optional label — never player markup. Turning it off
 * keeps the URL so it can be switched back on; removing it clears the record.
 */
export interface CollectionThemeMusic {
  readonly provider: ThemeMusicProvider;
  readonly url: string;
  readonly title: string | null;
  readonly enabled: boolean;
}

export interface CollectionArticleDefaults {
  readonly tagIds: readonly TagId[];
  readonly categoryIds: readonly CategoryId[];
  readonly experienceTags: readonly ExperienceTag[];
}

export const NO_ARTICLE_DEFAULTS: CollectionArticleDefaults = {
  tagIds: [],
  categoryIds: [],
  experienceTags: [],
};

export interface ArticleCollection {
  readonly articleId: ArticleId;
  readonly collectionId: CollectionId;
  readonly sortOrder: number;
}
