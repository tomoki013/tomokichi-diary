import { err, ok, type Result } from "../primitives/result.js";

/**
 * What a trip felt like, as opposed to where it happened or what it is about.
 *
 * Tags (`Tag`) stay free-form and describe content; experience tags are a
 * small closed vocabulary, because they are how a reader chooses a story
 * ("something moving", "something that went wrong") and a vocabulary that
 * grows by typo stops working as a way in. The values are stable identifiers:
 * how each one is worded on screen is a frontend decision, so a label can be
 * reworded without touching a single article.
 */
export const EXPERIENCE_TAGS = [
  /** Anticipation, the buzz of arriving somewhere new. */
  "exciting",
  /** A view or a moment that moved the author. */
  "moving",
  /** Trouble, close calls, scams, missed connections. */
  "thrilling",
  /** When it all went wrong — the "this is over" days, told with a straight face. */
  "disaster",
  /** Something that went sideways in a way worth laughing at. */
  "funny",
  /** A small surprise or a thing learnt on the spot. */
  "discovery",
  /** Something that took effort or nerve to do. */
  "challenge",
  /** The ones the author still thinks about. */
  "unforgettable",
] as const;
export type ExperienceTag = (typeof EXPERIENCE_TAGS)[number];

const KNOWN = new Set<string>(EXPERIENCE_TAGS);

export function isExperienceTag(value: unknown): value is ExperienceTag {
  return typeof value === "string" && KNOWN.has(value);
}

/**
 * Validates and normalises a list: unknown values are rejected rather than
 * dropped, and the result is de-duplicated and in vocabulary order so the same
 * set always serialises the same way.
 */
export function parseExperienceTags(values: readonly unknown[]): Result<readonly ExperienceTag[]> {
  const unknown = values.filter((value) => !isExperienceTag(value));
  if (unknown.length > 0) {
    return err({
      code: "API_VALIDATION_FAILED",
      message: `unknown experience tag: ${unknown.map(String).join(", ")} (expected one of ${EXPERIENCE_TAGS.join(", ")})`,
      field: "experienceTags",
    });
  }
  const chosen = new Set(values);
  return ok(EXPERIENCE_TAGS.filter((tag) => chosen.has(tag)));
}
