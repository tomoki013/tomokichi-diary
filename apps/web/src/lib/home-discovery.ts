import { EXPERIENCE_TAGS, isExperienceTag, type ExperienceTag } from "@tomokichi/domain";

/**
 * Discovery on the home page: pick a feeling and the stories right under the
 * picker change to match it, without leaving the page. Rule-based on purpose
 * — no model, no popularity numbers — and split into steps so choosing
 * articles never mixes with drawing them:
 *
 * 1. Selection       `parseHomeExperience`  query value → tag (or nothing)
 * 2. Recommendation  `recommend`            tag → ranked public articles
 * 3. Look           `lookFor`              tag → design, from `DISCOVERY_LOOKS`
 * 4. Rendering       `components/home/discovery/*Look.astro`
 *
 * Every feeling opens the same way — a photo scene with its catch line and,
 * always visible, the feeling's name and how many stories it has — so it is
 * never unclear which one is showing. Below that, each feeling lays its
 * stories out in a look of its own that carries the mood by sight alone:
 * nothing needs a tap or a hover to make sense, and no emoji are used. Everything here is a pure function over plain data so it
 * can be unit-tested without the content export.
 */

export type DiscoveryLookId =
  "carousel" | "spotlight" | "route" | "storm" | "snaps" | "atlas" | "ascent" | "glow";

/** Which look each feeling gets. The only place the mapping lives. */
export const DISCOVERY_LOOKS: Record<ExperienceTag, DiscoveryLookId> = {
  exciting: "carousel",
  moving: "spotlight",
  thrilling: "route",
  disaster: "storm",
  funny: "snaps",
  discovery: "atlas",
  challenge: "ascent",
  unforgettable: "glow",
};

export function lookFor(tag: ExperienceTag): DiscoveryLookId {
  return DISCOVERY_LOOKS[tag];
}

/**
 * The words each scene opens with: a catch line set large over the photo
 * (one array entry per line, so a phrase never breaks mid-word), its
 * English name in script, a quieter second line, and the heading over the
 * stories. Copy only — nothing here claims anything about the articles.
 */
export interface DiscoveryScene {
  readonly catchLines: readonly string[];
  readonly english: string;
  readonly sub: string;
  readonly section: string;
}

export const DISCOVERY_SCENES: Record<ExperienceTag, DiscoveryScene> = {
  exciting: {
    catchLines: ["次、どこへ", "ワクワクしに行く？"],
    english: "Exciting",
    sub: "見たことのない景色と、はじめての体験へ。",
    section: "おすすめのワクワク旅",
  },
  moving: {
    catchLines: ["こんな景色を", "また見たい。"],
    english: "Heart Moving",
    sub: "旅で、心が動いた瞬間を。",
    section: "心が動いた、あの瞬間たち",
  },
  thrilling: {
    catchLines: ["旅はいつも", "うまくいかない!?"],
    english: "Thrilling",
    sub: "失敗・トラブル・冷や汗エピソード集",
    section: "こんなハプニングがありました",
  },
  disaster: {
    catchLines: ["これは終わった…", "でも、なんとかなった。"],
    english: "Oops...",
    sub: "絶望からのリカバリー記録",
    section: "もうダメだと思った旅",
  },
  funny: {
    catchLines: ["旅って、", "こんなに笑えるんだ。"],
    english: "Funny",
    sub: "ハプニングも、全部いい思い出。",
    section: "思い出すと笑ってしまう話",
  },
  discovery: {
    catchLines: ["まだ知らない世界が、", "こんなにあった。"],
    english: "Discovery",
    sub: "行ってみて分かった、その土地のリアル。",
    section: "行ってみて分かったこと",
  },
  challenge: {
    catchLines: ["やってみたら、", "世界が変わった。"],
    english: "Challenge",
    sub: "少しの勇気で、見える景色がある。",
    section: "一歩ずつ、踏み込んだ旅",
  },
  unforgettable: {
    catchLines: ["あの旅は、", "今も心の中で輝いてる。"],
    english: "Unforgettable",
    sub: "時間が経っても、色褪せない旅の記憶。",
    section: "今でもふと思い出す旅",
  },
};

/** Stories per feeling. */
export const DISCOVERY_LIMIT = 5;

/** Lead with lived scenes that carry each feeling, rather than the latest guide. */
export const DISCOVERY_PICKS: Readonly<Record<ExperienceTag, readonly string[]>> = {
  moving: ["turkey3", "greece2", "spain6", "india2", "sunset1"],
  exciting: ["egypt2", "china3", "malaysia1", "singapore2", "turkey1"],
  thrilling: ["egypt4", "india1", "greece3", "turkey2", "china1"],
  disaster: ["greece1", "egypt4", "turkey2", "india7", "thai4"],
  funny: ["thai2", "malaysia3", "malaysia2", "thai4", "hokkaido1"],
  discovery: ["travel-history2", "china2", "india6", "spain5", "malaysia-before-thailand"],
  challenge: ["india5", "india4", "egypt3", "france2", "indonesia2"],
  unforgettable: ["india6", "turkey3", "greece2", "egypt2", "spain6"],
};

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
   * below). Among automatic fallback picks, prefer stories not shown there.
   */
  readonly shownElsewhere?: ReadonlySet<string>;
}

/**
 * Ranks `candidates` (expected newest first, as `content.articleViews()`
 * returns them) for one feeling. Rules, in order:
 *
 * 1. must carry the tag (duplicates by id are dropped)
 * 2. articles with a cover photo first (the layout leads with a photo)
 * 3. editorial picks in their chosen order
 * 4. remaining articles not already shown elsewhere on the page first
 * 5. the incoming order (newest first), then slug
 *
 * No engagement or "how moving" score exists in the data, so none is used.
 */
export function recommend<T extends DiscoveryCandidate>(
  candidates: readonly T[],
  tag: ExperienceTag,
  { limit = DISCOVERY_LIMIT, shownElsewhere = new Set() }: RecommendOptions = {},
): T[] {
  const seen = new Set<string>();
  const picks = new Map(DISCOVERY_PICKS[tag].map((slug, index) => [slug, index]));
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
        (picks.get(a.candidate.article.slug) ?? Infinity) -
          (picks.get(b.candidate.article.slug) ?? Infinity) ||
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
