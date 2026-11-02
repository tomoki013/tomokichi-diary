import type { ArticleId } from "../primitives/id.js";
import type { Brand } from "../primitives/brand.js";
import type { Instant } from "../primitives/datetime.js";
import type { ExperienceTag } from "./experience.js";

export type RankingId = Brand<string, "RankingId">;

/**
 * "ともきち的ランキング" on the home page: articles ranked by how a trip felt to
 * the author, never by popularity. Which articles and in what order is an
 * editorial choice made in the admin, so it is data rather than code. A
 * ranking with no picks stays off the site.
 */
export interface Ranking {
  readonly id: RankingId;
  readonly title: string;
  /** A handwritten-style aside next to the title. */
  readonly note: string;
  /** Where the "more" link goes: the list of articles with this experience tag. */
  readonly experienceTag: ExperienceTag | null;
  /** First is #1. */
  readonly picks: readonly RankingPick[];
  readonly sortOrder: number;
  readonly updatedAt: Instant | null;
}

export interface RankingPick {
  readonly articleId: ArticleId;
  /** Why it sits at this rank, in the author's voice. Empty shows the title alone. */
  readonly comment: string;
}

export const RANKING_LIMITS = {
  title: 60,
  note: 40,
  comment: 80,
  picks: 15,
} as const;
