import { EXPERIENCE_TAGS, isExperienceTag, type ExperienceTag } from "@tomokichi/domain";

/**
 * Discovery on the home page: pick a feeling and the stories right under the
 * picker change to match it, without leaving the page. Rule-based on purpose
 * — no model, no popularity numbers — and split into steps so choosing
 * articles never mixes with drawing them:
 *
 * 1. Selection       `parseHomeExperience`  query value → tag (or nothing)
 * 2. Recommendation  `recommend`            tag → ranked public articles
 * 3. Rendering       `components/home/discovery/*`
 *
 * Every feeling shares one plain, readable layout; what tells them apart at
 * a glance is the feeling itself — its face, colour and one-line lead (see
 * `lib/experiences.ts`). Everything here is a pure function over plain data
 * so it can be unit-tested without the content export.
 */

/** Stories per feeling: one large, the rest as rows. */
export const DISCOVERY_LIMIT = 4;

/** The URL query that carries the selection. Home stays canonical to `/`. */
export const HOME_EXPERIENCE_PARAM = "homeExperience";

/**
 * Shown before the reader picks anything (and without JavaScript): a
 * feeling with plenty of photos first, then the rest in vocabulary order.
 */
const DEFAULT_PREFERENCE: readonly ExperienceTag[] = ["moving", ...EXPERIENCE_TAGS];

/** A query value is trusted only if it is one of the eight tags, verbatim. */
export function parseHomeExperience(value: string | null | undefined): ExperienceTag | null {
  return value && isExperienceTag(value) ? value : null;
}

/** The first preferred feeling that has at least one story, or nothing. */
export function defaultExperience(
  counts: Readonly<Partial<Record<ExperienceTag, number>>>,
): ExperienceTag | null {
  return DEFAULT_PREFERENCE.find((tag) => (counts[tag] ?? 0) > 0) ?? null;
}

/** The minimum an article needs to be recommended; `ArticleView` satisfies it. */
export interface DiscoveryCandidate {
  readonly article: {
    readonly id: string;
    readonly slug: string;
    readonly experienceTags: readonly ExperienceTag[];
  };
  readonly cover: unknown;
}

export interface RecommendOptions {
  readonly limit?: number;
  /**
   * Articles already prominent on the page (the best-episode carousel right
   * below). They are still eligible, but only after everything else, so the
   * area surfaces stories the reader has not just scrolled past.
   */
  readonly shownElsewhere?: ReadonlySet<string>;
}

/**
 * Ranks `candidates` (expected newest first, as `content.articleViews()`
 * returns them) for one feeling. Rules, in order:
 *
 * 1. must carry the tag (duplicates by id are dropped)
 * 2. articles with a cover photo first (the layout leads with a photo)
 * 3. articles not already shown elsewhere on the page first
 * 4. the incoming order (newest first)
 * 5. slug, so the result never depends on sort stability
 *
 * No engagement or "how moving" score exists in the data, so none is used.
 */
export function recommend<T extends DiscoveryCandidate>(
  candidates: readonly T[],
  tag: ExperienceTag,
  { limit = DISCOVERY_LIMIT, shownElsewhere = new Set() }: RecommendOptions = {},
): T[] {
  const seen = new Set<string>();
  return candidates
    .flatMap((candidate, order) => {
      const { id, experienceTags } = candidate.article;
      if (!experienceTags.includes(tag) || seen.has(id)) return [];
      seen.add(id);
      return [{ candidate, order }];
    })
    .toSorted(
      (a, b) =>
        rank(!a.candidate.cover) - rank(!b.candidate.cover) ||
        rank(shownElsewhere.has(a.candidate.article.id)) -
          rank(shownElsewhere.has(b.candidate.article.id)) ||
        a.order - b.order ||
        a.candidate.article.slug.localeCompare(b.candidate.article.slug),
    )
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.candidate);
}

const rank = (late: boolean) => (late ? 1 : 0);

/** `2024-03-08` → `2024.03`; anything malformed reads as unknown. */
export function travelMonthOf(date: string | null | undefined): string | null {
  const match = date?.match(/^(\d{4})-(\d{2})/);
  return match ? `${match[1]}.${match[2]}` : null;
}

/** `カッパドキア / トルコ`, or just the one name when they coincide. */
export function placeLabel(primary: string | null, country: string | null): string | null {
  if (!primary) return country;
  return country && country !== primary ? `${primary} / ${country}` : primary;
}

/** What a template draws for one article: plain, already-resolved strings. */
export interface DiscoveryItem {
  readonly slug: string;
  readonly path: string;
  readonly title: string;
  readonly summary: string;
  readonly cover: { readonly storageKey: string; readonly alt: string } | null;
  readonly place: string | null;
  readonly travelMonth: string | null;
}
