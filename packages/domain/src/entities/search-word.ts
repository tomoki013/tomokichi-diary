import type { Instant } from "../primitives/datetime.js";

/**
 * Another way readers type a word the articles already use: a reading
 * ("CHAGEE" as "チャジー"), another script ("霸王茶姬") or another spelling
 * ("Mirador del Valle" as "ミラドール・デル・バジェ"). Search only: never shown
 * on the site. An article that mentions `word` or any of `also`, in its
 * title, summary, tags or body, is found by all of them.
 */
export interface SearchWord {
  readonly word: string;
  readonly also: readonly string[];
  readonly updatedAt: Instant | null;
}

export const SEARCH_WORD_LIMITS = { word: 60, also: 12, words: 300 } as const;
