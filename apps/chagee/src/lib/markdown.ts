/**
 * A deliberately small Markdown renderer for news bodies.
 *
 * Supported: `##` / `###` headings, paragraphs, `-` and `1.` lists, `**bold**`
 * and `[text](url)`. Everything else is escaped text. Links are only kept for
 * http(s) URLs and site-relative paths, so a body can never inject markup or a
 * `javascript:` URL even if a row is edited by hand.
 */

export interface Heading {
  id: string;
  text: string;
  level: 2 | 3;
}

export interface Rendered {
  html: string;
  headings: Heading[];
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeHref(url: string): string | null {
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

/** Inline formatting on already-escaped text. */
function inline(raw: string): string {
  let out = "";
  let rest = raw;
  const link = /\[([^\]]+)\]\(([^)\s]+)\)/;
  for (let match = link.exec(rest); match !== null; match = link.exec(rest)) {
    out += bold(escapeHtml(rest.slice(0, match.index)));
    const href = safeHref(match[2] ?? "");
    const label = bold(escapeHtml(match[1] ?? ""));
    if (href === null) out += label;
    else {
      const external = !href.startsWith("/");
      out += `<a href="${escapeHtml(href)}"${external ? ' rel="noopener" target="_blank"' : ""}>${label}</a>`;
    }
    rest = rest.slice(match.index + match[0].length);
  }
  return out + bold(escapeHtml(rest));
}

function bold(escaped: string): string {
  return escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

export function renderMarkdown(source: string): Rendered {
  const headings: Heading[] = [];
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flush = () => {
    if (paragraph.length > 0) blocks.push(`<p>${inline(paragraph.join(""))}</p>`);
    paragraph = [];
    if (list !== null) {
      const tag = list.ordered ? "ol" : "ul";
      blocks.push(
        `<${tag}>${list.items.map((item) => `<li>${inline(item)}</li>`).join("")}</${tag}>`,
      );
    }
    list = null;
  };

  for (const line of source.replaceAll("\r\n", "\n").split("\n")) {
    const trimmed = line.trim();
    const heading = /^(#{2,3})\s+(.+)$/.exec(trimmed);
    const bullet = /^[-*]\s+(.+)$/.exec(trimmed);
    const numbered = /^\d+\.\s+(.+)$/.exec(trimmed);
    if (trimmed === "") {
      flush();
    } else if (heading) {
      flush();
      const level = heading[1] === "##" ? 2 : 3;
      const text = heading[2] ?? "";
      const id = `h-${headings.length + 1}`;
      headings.push({ id, text: text.replace(/\*\*/g, ""), level });
      blocks.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
    } else if (bullet || numbered) {
      const ordered = numbered !== null;
      if (paragraph.length > 0 || (list !== null && list.ordered !== ordered)) flush();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)?.[1] ?? "");
    } else {
      if (list !== null) flush();
      paragraph.push(trimmed);
    }
  }
  flush();
  return { html: blocks.join("\n"), headings };
}

/** Plain text for descriptions and search: Markdown syntax removed. */
export function plainText(source: string): string {
  return source
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#*]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
