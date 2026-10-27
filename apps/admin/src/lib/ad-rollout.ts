import { marked } from "marked";

export interface AdPosition {
  offset: number;
  excerpt: string;
  fraction: number;
}
const unsafe = (raw: string) =>
  /!\[|\{\{(?:embed|monetization):|<\/?(?:img|figure|aside|iframe|video|script)|^\s*\[.+\]\(/im.test(
    raw,
  );
/** Only top-level prose paragraphs, after the introduction and away from images/cards/embeds. */
export function suggestAdParagraph(body: string): AdPosition | null {
  const tokens = marked.lexer(body);
  let cursor = 0;
  const candidates: AdPosition[] = [];
  const content = tokens.filter((t) => t.type !== "space");
  for (let i = 0; i < content.length; i++) {
    const token = content[i]!;
    const start = body.indexOf(token.raw, cursor);
    if (start < 0) continue;
    cursor = start + token.raw.length;
    const before = body.slice(0, cursor);
    const next = content[i + 1];
    if (
      token.type !== "paragraph" ||
      unsafe(token.raw) ||
      !next ||
      unsafe(next.raw) ||
      next.type === "html" ||
      next.type === "code" ||
      next.type === "table"
    )
      continue;
    if (before.replace(/\s/g, "").length < 600 || !/^## /m.test(before)) continue;
    const fraction = cursor / body.length;
    if (fraction < 0.3 || fraction > 0.65 || token.raw.trim().length < 30) continue;
    candidates.push({ offset: cursor, excerpt: token.raw.trim().slice(-140), fraction });
  }
  return (
    candidates.toSorted((a, b) => Math.abs(a.fraction - 0.4) - Math.abs(b.fraction - 0.4))[0] ??
    null
  );
}
