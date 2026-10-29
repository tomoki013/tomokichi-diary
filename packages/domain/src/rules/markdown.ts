/**
 * Structural reads over the canonical Markdown body. Rendering to HTML is an
 * adapter concern; these helpers exist so validation, SEO and link checking do
 * not need a renderer (and stay identical across frontends).
 */

const EMBED_RE = /\{\{embed:([a-z0-9]+(?:-[a-z0-9]+)*)\}\}/g;
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/gm;
const LINK_RE = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const FENCE_RE = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;

export interface Heading {
  readonly level: number;
  readonly text: string;
}

export function stripCodeFences(markdown: string): string {
  return markdown.replace(FENCE_RE, "");
}

export function extractEmbedAnchors(markdown: string): string[] {
  return [...stripCodeFences(markdown).matchAll(EMBED_RE)].map((m) => m[1]!);
}

export function extractHeadings(markdown: string): Heading[] {
  return [...stripCodeFences(markdown).matchAll(HEADING_RE)].map((m) => ({
    level: m[1]!.length,
    text: m[2]!.trim(),
  }));
}

export function extractLinks(markdown: string): string[] {
  const body = stripCodeFences(markdown);
  const images = new Set([...body.matchAll(IMAGE_RE)].map((m) => m[2]!));
  return [...body.matchAll(LINK_RE)].map((m) => m[1]!).filter((href) => !images.has(href));
}

export function extractInternalLinks(markdown: string): string[] {
  return extractLinks(markdown).filter((href) => href.startsWith("/"));
}

export interface MarkdownImage {
  readonly alt: string;
  readonly src: string;
}

export function extractImages(markdown: string): MarkdownImage[] {
  return [...stripCodeFences(markdown).matchAll(IMAGE_RE)].map((m) => ({ alt: m[1]!, src: m[2]! }));
}

/**
 * Heading structure problems that hurt both readers and machine parsing: a body
 * should not contain an `h1` (the page supplies it) and levels must not jump.
 */
export function validateHeadingStructure(markdown: string): string[] {
  const headings = extractHeadings(markdown);
  const problems: string[] = [];
  let previous = 1;
  for (const heading of headings) {
    if (heading.level === 1) problems.push(`h1 in body: "${heading.text}"`);
    else if (heading.level > previous + 1) {
      problems.push(
        `heading level jumps from h${previous} to h${heading.level}: "${heading.text}"`,
      );
    }
    previous = heading.level;
  }
  return problems;
}

/** Plain text for descriptions and summaries when no explicit summary exists. */
export function toPlainText(markdown: string): string {
  return stripCodeFences(markdown)
    .replace(EMBED_RE, "")
    .replace(IMAGE_RE, "")
    .replace(LINK_RE, (match) => /\[([^\]]*)\]/.exec(match)?.[1] ?? "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*\|.*\|\s*$/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Truncates on a character boundary that reads well in Japanese and English. */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const boundary = Math.max(cut.lastIndexOf("。"), cut.lastIndexOf("、"), cut.lastIndexOf(" "));
  return `${(boundary > maxLength * 0.6 ? cut.slice(0, boundary + 1) : cut).trimEnd()}…`;
}

const INLINE_CODE_RE = /`[^`\n]*`/g;
const HTML_TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9-]*)(?=[\s/>])[^>]*>/g;

/**
 * Raw HTML in the body that the editor did not need: Markdown covers it, and a
 * pasted tag otherwise slips past every check that reads the Markdown. `strong`
 * stays because `**` does not open or close next to Japanese brackets
 * (`**「名前」**は`). Inline affiliate links are written `[ラベル](URL "広告")`
 * and get their rel and disclosure at build time.
 */
export function disallowedHtml(markdown: string): string[] {
  // `](</images/a.jpg>)` is a Markdown destination in angle brackets, not a tag.
  const body = stripCodeFences(markdown)
    .replace(INLINE_CODE_RE, "")
    .replace(/\]\(\s*<[^>\n]*>/g, "](");
  return [
    ...new Set(
      [...body.matchAll(HTML_TAG_RE)]
        .filter((m) => m[1]!.toLowerCase() !== "strong")
        .map((m) => m[0]),
    ),
  ];
}

const SITE_ORIGIN = "https://tomokichidiary.com";
const LIST_ITEM_RE = /^\s*(?:[-*+]|\d+\.)\s+/;
const LONE_LINK_RE = /^\[[^\]]*\]\([^)\s]+(?:\s+"[^"]*")?\)$/;

function isSiteLink(href: string): boolean {
  if (href.startsWith("#") || href.startsWith("//")) return false;
  try {
    return new URL(href, `${SITE_ORIGIN}/posts/`).origin === SITE_ORIGIN;
  } catch {
    return false;
  }
}

/**
 * Links to the site's own pages that sit inside a sentence. The page turns a
 * paragraph or list item holding nothing but one such link into a card with
 * the target's photo and summary; a link inside running text stays a bare
 * link, so the body is expected to give it its own line.
 */
export function inlineInternalLinks(markdown: string): string[] {
  const units = stripCodeFences(markdown)
    .split(/\n\s*\n/)
    .flatMap((block) => {
      const lines = block.split("\n").map((line) => line.replace(/^\s*>\s?/, ""));
      if (lines.every((line) => line.trim() === "" || /^\s*(#|\|)/.test(line))) return [];
      if (!LIST_ITEM_RE.test(lines[0] ?? "")) return [lines.join("\n")];
      const items: string[] = [];
      for (const line of lines) {
        if (LIST_ITEM_RE.test(line)) items.push(line.replace(LIST_ITEM_RE, ""));
        else items[items.length - 1] += `\n${line}`;
      }
      return items;
    });
  return units.flatMap((unit) => {
    if (LONE_LINK_RE.test(unit.trim())) return [];
    return extractLinks(unit).filter(isSiteLink);
  });
}

const PUNCTUATION_RE = /[\p{P}\p{S}]/u;
const SPACE_RE = /\s/u;

/**
 * `**…**` pairs the renderer will print as literal asterisks. CommonMark only
 * lets `**` close when it is not squeezed between punctuation and a letter, so
 * `**「名前」**は` and `**（注）**後` stay as text — Japanese brackets are
 * punctuation and Japanese has no spaces to break the tie. `<strong>` is the
 * way out in those spots. Returns the unrendered spans.
 */
export function ineffectiveBold(markdown: string): string[] {
  const kind = (ch: string | undefined): "space" | "punct" | "other" =>
    ch === undefined || SPACE_RE.test(ch) ? "space" : PUNCTUATION_RE.test(ch) ? "punct" : "other";
  const problems: string[] = [];
  for (const block of stripCodeFences(markdown).split(/\n\s*\n/)) {
    const text = block.replace(INLINE_CODE_RE, (code) => " ".repeat(code.length));
    const runs: { at: number; canOpen: boolean; canClose: boolean }[] = [];
    for (const m of text.matchAll(/(?<![*\\])\*\*(?!\*)/g)) {
      const before = kind(text[m.index - 1]);
      const after = kind(text[m.index + 2]);
      const left = after !== "space" && (after !== "punct" || before !== "other");
      const right = before !== "space" && (before !== "punct" || after !== "other");
      runs.push({ at: m.index, canOpen: left, canClose: right });
    }
    for (let i = 0; i < runs.length; i += 2) {
      const open = runs[i]!;
      const close = runs[i + 1];
      if (close && open.canOpen && close.canClose) continue;
      const end = close ? close.at + 2 : Math.min(text.length, open.at + 30);
      problems.push(block.slice(open.at, end).replace(/\s+/g, " "));
    }
  }
  return problems;
}

/** URLs of the inline affiliate links, written `[ラベル](URL "広告")`. */
export function inlineAffiliateLinks(markdown: string): string[] {
  const body = stripCodeFences(markdown).replace(INLINE_CODE_RE, "");
  return [...body.matchAll(/(?<!!)\[[^\]]*\]\(\s*<?([^\s)>]+)>?\s+"広告"\s*\)/g)].map((m) => m[1]!);
}
