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

export type DiscoveryTemplateId =
  "board" | "cinema" | "pulse" | "collapse" | "gacha" | "lens" | "letters" | "develop";

/**
 * A scene, not a skin: each feeling gets its own small piece of play, so the
 * reader *feels* the mood before reading a word. The data shown is always
 * the article's own; the play is in how it is revealed.
 */
export interface DiscoveryTemplate {
  readonly id: DiscoveryTemplateId;
  /** Shown above the stories so the reader can tell the layout changed on purpose. */
  readonly label: string;
  /** One word on the mood tiles, so the reader sees each feeling has its own scene. */
  readonly short: string;
  /** Whether the scene leans on photos; articles with a cover are ranked first. */
  readonly needsPhoto: boolean;
  /** How many stories the scene holds. */
  readonly limit: number;
}

export const TEMPLATES: Record<DiscoveryTemplateId, DiscoveryTemplate> = {
  board: { id: "board", label: "出発案内板", short: "出発便", needsPhoto: false, limit: 6 },
  cinema: { id: "cinema", label: "シネマ", short: "映画", needsPhoto: true, limit: 4 },
  pulse: { id: "pulse", label: "心拍モニター", short: "心拍", needsPhoto: true, limit: 4 },
  collapse: { id: "collapse", label: "崩れ落ちた旅", short: "崩壊", needsPhoto: true, limit: 4 },
  gacha: { id: "gacha", label: "笑い話ガチャ", short: "ガチャ", needsPhoto: true, limit: 8 },
  lens: { id: "lens", label: "虫眼鏡で探す", short: "虫眼鏡", needsPhoto: true, limit: 4 },
  letters: { id: "letters", label: "挑戦状", short: "挑戦状", needsPhoto: false, limit: 4 },
  develop: { id: "develop", label: "記憶を現像する", short: "現像", needsPhoto: true, limit: 4 },
};

/** Which scene each feeling gets. The only place the mapping lives. */
export const DISCOVERY_TEMPLATES: Record<ExperienceTag, DiscoveryTemplateId> = {
  exciting: "board",
  moving: "cinema",
  thrilling: "pulse",
  disaster: "collapse",
  funny: "gacha",
  discovery: "lens",
  challenge: "letters",
  unforgettable: "develop",
};

/** The URL query that carries the selection. Home stays canonical to `/`. */
export const HOME_EXPERIENCE_PARAM = "homeExperience";

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
 * 2. photo scenes: articles with a cover first
 * 3. articles not already shown elsewhere on the page first
 * 4. the incoming order (newest first)
 * 5. slug, so the result never depends on sort stability
 *
 * No engagement or "how moving" score exists in the data, so none is used.
 */
export function recommend<T extends DiscoveryCandidate>(
  candidates: readonly T[],
  tag: ExperienceTag,
  { limit = templateFor(tag).limit, shownElsewhere = new Set() }: RecommendOptions = {},
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

/** One labelled fact on a story card. */
export interface DiscoveryFact {
  readonly label: string;
  readonly value: string;
}

/**
 * The labelled rows a scene may print under a story. A row exists only when
 * the data does: nothing is estimated. Practical rows (fares, durations)
 * belong here once articles carry them.
 */
export function storyFacts(item: {
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
