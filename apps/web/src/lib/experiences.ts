import { EXPERIENCE_TAGS, isExperienceTag, type ExperienceTag } from "@tomokichi/domain";

/**
 * How each experience tag reads on the page. The article data only carries the
 * identifier (`moving`), so rewording a label here never touches content.
 */
export interface ExperienceCopy {
  /** Short label for chips and filters. */
  readonly label: string;
  /** One line that invites the reader in, used on the home tiles. */
  readonly lead: string;
  /** A doodle glyph drawn next to the label — decoration, hidden from screen readers. */
  readonly mark: string;
  /** Hue for the chip and tile accents; saturation and lightness come from CSS. */
  readonly hue: number;
}

export const EXPERIENCE_COPY: Record<ExperienceTag, ExperienceCopy> = {
  exciting: { label: "ワクワク", lead: "着いた瞬間から、胸が高鳴った旅", mark: "☀", hue: 24 },
  moving: { label: "感動", lead: "景色や人に、心が動いた旅", mark: "♡", hue: 350 },
  thrilling: { label: "ハラハラ", lead: "トラブルに冷や汗をかいた旅", mark: "⚡", hue: 45 },
  funny: { label: "笑える", lead: "思い出すと、つい笑ってしまう旅", mark: "☺", hue: 160 },
  discovery: { label: "発見", lead: "行ってみて、初めて分かった旅", mark: "✦", hue: 200 },
  challenge: { label: "挑戦", lead: "ちょっと無理して、踏み込んだ旅", mark: "▲", hue: 100 },
  unforgettable: { label: "忘れられない", lead: "今でもふと思い出す旅", mark: "★", hue: 265 },
};

/** In vocabulary order, which is also the order the filters and tiles use. */
export const EXPERIENCES = EXPERIENCE_TAGS.map((tag) => ({ tag, ...EXPERIENCE_COPY[tag] }));

/**
 * The archive filtered to one experience. `#results` lands the reader on the
 * list rather than on the archive's masthead.
 */
export function experienceHref(tag: ExperienceTag): string {
  return `/posts?experience=${tag}#results`;
}

export function experienceCopy(value: string): (ExperienceCopy & { tag: ExperienceTag }) | null {
  return isExperienceTag(value) ? { tag: value, ...EXPERIENCE_COPY[value] } : null;
}
