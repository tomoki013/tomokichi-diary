import { EXPERIENCE_TAGS, isExperienceTag, type ExperienceTag } from "@tomokichi/domain";

/**
 * Adaptive discovery on the home page: pick a feeling and the stories under
 * the picker change *shape*, not just membership. Rule-based on purpose — no
 * model, no popularity numbers — and split into the four steps the component
 * walks through, so choosing articles never mixes with drawing them:
 *
 * 1. Selection    `parseHomeExperience`  query value → tag (or nothing)
 * 2. Recommendation `recommend`          tag → ranked public articles
 * 3. Template     `templateFor`          tag → layout, from `DISCOVERY_TEMPLATES`
 * 4. Rendering    `components/home/discovery/*`
 *
 * Everything here is a pure function over plain data so it can be unit-tested
 * without the content export.
 */

export type DiscoveryTemplateId = "visual" | "story" | "explorer";

export interface DiscoveryTemplate {
  readonly id: DiscoveryTemplateId;
  /** Shown above the stories so the reader can tell the layout changed on purpose. */
  readonly label: string;
  /** Whether the layout leans on photos; articles with a cover are ranked first. */
  readonly needsPhoto: boolean;
}

export const TEMPLATES: Record<DiscoveryTemplateId, DiscoveryTemplate> = {
  visual: { id: "visual", label: "写真で浸る", needsPhoto: true },
  story: { id: "story", label: "物語をたどる", needsPhoto: false },
  explorer: { id: "explorer", label: "見比べて探す", needsPhoto: false },
};

/** Which layout each feeling gets. The only place the mapping lives. */
export const DISCOVERY_TEMPLATES: Record<ExperienceTag, DiscoveryTemplateId> = {
  moving: "visual",
  unforgettable: "visual",
  thrilling: "story",
  disaster: "story",
  challenge: "story",
  funny: "story",
  exciting: "explorer",
  discovery: "explorer",
};

/** The URL query that carries the selection. Home stays canonical to `/`. */
export const HOME_EXPERIENCE_PARAM = "homeExperience";

/** Stories per feeling. */
export const DISCOVERY_LIMIT = 4;

/**
 * Shown before the reader picks anything (and without JavaScript): a photo
 * layout first, then the rest in vocabulary order.
 */
const DEFAULT_PREFERENCE: readonly ExperienceTag[] = ["moving", ...EXPERIENCE_TAGS];

export function templateFor(tag: ExperienceTag): DiscoveryTemplate {
  return TEMPLATES[DISCOVERY_TEMPLATES[tag]];
}

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
 * 2. photo layouts: articles with a cover first
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
  const needsPhoto = templateFor(tag).needsPhoto;
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
        (needsPhoto ? rank(!a.candidate.cover) - rank(!b.candidate.cover) : 0) ||
        rank(shownElsewhere.has(a.candidate.article.id)) -
          rank(shownElsewhere.has(b.candidate.article.id)) ||
        a.order - b.order ||
        a.candidate.article.slug.localeCompare(b.candidate.article.slug),
    )
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.candidate);
}

const rank = (late: boolean) => (late ? 1 : 0);

/** One labelled fact on an explorer card. */
export interface DiscoveryFact {
  readonly label: string;
  readonly value: string;
}

/**
 * The comparable rows of an explorer card. A row exists only when the data
 * does: nothing is estimated. Practical rows (fares, durations) belong here
 * once articles carry them.
 */
export function explorerFacts(item: {
  readonly place: string | null;
  readonly travelMonth: string | null;
  readonly categories: readonly string[];
}): DiscoveryFact[] {
  const facts: (DiscoveryFact | null)[] = [
    item.place ? { label: "地域", value: item.place } : null,
    item.travelMonth ? { label: "旅の時期", value: item.travelMonth } : null,
    item.categories.length > 0 ? { label: "テーマ", value: item.categories.join("・") } : null,
  ];
  return facts.filter((fact): fact is DiscoveryFact => fact !== null);
}

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
  readonly categories: readonly string[];
}
