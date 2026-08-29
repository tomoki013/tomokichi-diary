import type { ArticleId, MediaId } from "../primitives/id.js";

/**
 * The stored original. `storageKey` is opaque: resolving it to a public URL is
 * an adapter concern, so moving from R2 to another object store touches no rows.
 */
export interface MediaAsset {
  readonly id: MediaId;
  readonly storageKey: string;
  readonly mimeType: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly size: number;
  readonly sha256: string;
  readonly createdAt: string;
}

export const MEDIA_ROLES = ["cover", "inline", "gallery", "og"] as const;
export type MediaRole = (typeof MEDIA_ROLES)[number];

/**
 * Usage, not the asset, carries alt text and caption: the same photo describes
 * something different in each article it appears in.
 */
export interface ArticleMedia {
  readonly articleId: ArticleId;
  readonly mediaId: MediaId;
  readonly role: MediaRole;
  readonly sortOrder: number;
  readonly alt: string;
  readonly caption: string | null;
}
