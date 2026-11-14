export interface SearchWordEntry {
  word: string;
  also: string[];
}
type Stored = { readonly word: string; readonly also: readonly string[] };

/** One word per line, as the author types it: `CHAGEE = チャジー、霸王茶姬`. */
export function formatSearchWords(items: readonly Stored[]): string {
  return items.map((item) => `${item.word} = ${item.also.join("、")}`).join("\n");
}

/**
 * Reads the lines back. Either `=` works, and readings may be split by a
 * Japanese or a Western comma. A line without readings is reported rather
 * than dropped, so nothing typed is lost silently.
 */
export function parseSearchWords(text: string): { items: SearchWordEntry[]; problems: string[] } {
  const items: SearchWordEntry[] = [];
  const problems: string[] = [];
  for (const [index, raw] of text.split("\n").entries()) {
    const line = raw.trim();
    if (line === "") continue;
    const at = line.search(/[=＝]/);
    const word = (at < 0 ? line : line.slice(0, at)).trim();
    const also = (at < 0 ? "" : line.slice(at + 1))
      .split(/[、,，]/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (word === "" || also.length === 0)
      problems.push(`${index + 1}行目「${line}」は「語 = 読み、別の書き方」の形にしてください`);
    else items.push({ word, also });
  }
  return { items, problems };
}
