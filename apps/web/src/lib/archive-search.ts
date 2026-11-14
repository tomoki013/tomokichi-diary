/**
 * How the article list matches what a reader types. Shared by the build (which
 * writes each card's text) and the page script (which reads the query), so
 * both fold text the same way.
 */

/**
 * One spelling for text that readers type several ways: full-width and
 * half-width, upper and lower case, hiragana and katakana ("ちゃじー" finds
 * "チャジー"), small and full-size kana ("ばいえ" finds "バイェ"), and the
 * separators in a slug ("france-1" finds "france1").
 */
const SMALL_KANA: Record<string, string> = {
  ァ: "ア",
  ィ: "イ",
  ゥ: "ウ",
  ェ: "エ",
  ォ: "オ",
  ャ: "ヤ",
  ュ: "ユ",
  ョ: "ヨ",
  ッ: "ツ",
  ヮ: "ワ",
};
export function normalizeSearch(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase("ja")
    .replace(/[ぁ-ゖ]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 0x60))
    .replace(/[ァィゥェォャュョッヮ]/g, (char) => SMALL_KANA[char] ?? char)
    .replace(/[-_/・、。,.!?！？「」『』（）()｜|:：]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The words of a query: every one of them has to be found. */
export function searchTerms(query: string): string[] {
  return normalizeSearch(query).split(" ").filter(Boolean);
}

const squeeze = (text: string) => text.replaceAll(" ", "");

/**
 * 0 when the card does not match; otherwise higher for a better match. A word
 * found in the title or the slug counts for more than one found only in the
 * summary, tags or places, and a slug typed in full counts for the most.
 * Spaces are ignored on both sides, so "france 1" finds "france1" and
 * "クアラ ルンプール" finds "クアラルンプール".
 */
export function matchScore(heading: string, text: string, terms: readonly string[]): number {
  if (terms.length === 0) return 1;
  const head = squeeze(heading);
  const body = squeeze(text);
  let score = 0;
  for (const term of terms) {
    if (heading.split(" ").includes(term)) score += 6;
    else if (head.includes(term)) score += 3;
    else if (body.includes(term)) score += 1;
    else return 0;
  }
  // The whole query run together ("france 1" as "france1") is the reader
  // naming one article: it leads the others that merely contain each word.
  if (terms.length > 1 && head.includes(terms.join(""))) score += 10;
  return score;
}

/**
 * The search-only words an article answers to: every spelling of each entry
 * that the article mentions in any spelling. `mention` is everything the
 * article says (title, summary, tags, body). Spaces are ignored, so
 * "ミラドール・デル・バジェ" in the body is found by "みらどーるでるばいえ".
 */
export function searchWordsFor(
  mention: string,
  words: readonly { readonly word: string; readonly also: readonly string[] }[],
): string[] {
  const said = squeeze(normalizeSearch(mention));
  return words.flatMap((entry) => {
    const spellings = [entry.word, ...entry.also].map(normalizeSearch).filter(Boolean);
    return spellings.some((spelling) => said.includes(squeeze(spelling))) ? spellings : [];
  });
}
