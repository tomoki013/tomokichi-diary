import {
  err,
  ok,
  SEARCH_WORD_LIMITS,
  type DomainError,
  type Result,
  type SearchWord,
} from "@tomokichi/domain";
import type { AppContext } from "../../context.js";

const fail = (message: string, field: string): DomainError => ({
  code: "API_VALIDATION_FAILED",
  message,
  field,
});

/** Compared ignoring case and width, so "CHAGEE" and "ｃｈａｇｅｅ" are one word. */
const fold = (text: string) => text.normalize("NFKC").toLocaleLowerCase("ja");

/**
 * Replaces the whole search-only word list. A word appears once, across every
 * entry: the same reading under two words would make both find each other's
 * articles. Empty readings are dropped; an entry left with none is refused,
 * since it would change nothing.
 */
export async function saveSearchWords(
  ctx: AppContext,
  input: readonly { readonly word: string; readonly also: readonly string[] }[],
): Promise<Result<readonly SearchWord[]>> {
  if (input.length > SEARCH_WORD_LIMITS.words)
    return err(fail(`at most ${SEARCH_WORD_LIMITS.words} words`, "words"));
  const seen = new Set<string>();
  const now = ctx.clock.now();
  const words: SearchWord[] = [];
  for (const [index, entry] of input.entries()) {
    const word = entry.word.trim();
    const also = [...new Set(entry.also.map((item) => item.trim()).filter(Boolean))];
    if (word === "") return err(fail("word is required", `words.${index}.word`));
    if (also.length === 0)
      return err(fail(`「${word}」に別の書き方がありません`, `words.${index}.also`));
    if (also.length > SEARCH_WORD_LIMITS.also)
      return err(fail(`at most ${SEARCH_WORD_LIMITS.also} per word`, `words.${index}.also`));
    for (const item of [word, ...also]) {
      if (item.length > SEARCH_WORD_LIMITS.word)
        return err(fail(`「${item}」が長すぎます`, `words.${index}`));
      if (seen.has(fold(item))) return err(fail(`「${item}」が2か所にあります`, `words.${index}`));
      seen.add(fold(item));
    }
    words.push({ word, also, updatedAt: now });
  }
  await ctx.repos.searchWords.replaceAll(words);
  ctx.logger.info("search.words_saved", { count: words.length });
  return ok(words);
}
