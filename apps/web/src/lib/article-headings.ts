/**
 * Section headings of a rendered article body. Shared by the body, which needs
 * every h2/h3 to carry an id, and the page, which lists them as contents
 * before the body renders.
 */
export interface ArticleHeading {
  readonly id: string;
  readonly level: 2 | 3;
  readonly text: string;
}

/** Headings Markdown left without an id get one, numbered in document order. */
export function withHeadingIds(html: string): string {
  let index = 0;
  return html.replace(/<h([23])>(.*?)<\/h\1>/gi, (_match, level, inner: string) => {
    const text = inner.replace(/<[^>]+>/g, "").trim();
    const id = `section-${++index}-${text.replace(/\s+/g, "-").slice(0, 48)}`;
    return `<h${level} id="${id}">${inner}</h${level}>`;
  });
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#x27;": "'",
};

/** Plain text, so the caller's template escapes it once rather than twice. */
const decode = (value: string) =>
  value.replace(/&(?:amp|lt|gt|quot|#39|#x27);/g, (entity) => ENTITIES[entity] ?? entity);

export function articleHeadings(html: string | null): ArticleHeading[] {
  if (html === null) return [];
  return [
    ...withHeadingIds(html).matchAll(/<h([23])\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/gi),
  ].map(([, level, id = "", inner = ""]) => ({
    id: decode(id),
    level: level === "3" ? 3 : 2,
    text: decode(inner.replace(/<[^>]+>/g, "").trim()),
  }));
}
