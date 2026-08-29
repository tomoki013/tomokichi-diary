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
