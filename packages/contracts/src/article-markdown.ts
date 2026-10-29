import Slugger from "github-slugger";
import { Marked } from "marked";

/**
 * The one Markdown renderer for article bodies. The public site and the admin
 * preview both call it, so what the editor previews is what readers get.
 *
 * Its output matches what the site rendered before through Astro's renderer
 * (satteri, with GFM and smart punctuation): marked does the Markdown and
 * `smartPunctuation` reproduces satteri's quotes, dashes and ellipses.
 */
const marked = new Marked({ gfm: true, breaks: false });

export function renderArticleMarkdown(markdown: string): string {
  const html = marked.parse(markdown, { async: false }) as string;
  return withHeadingSlugs(
    smartPunctuation(
      // satteri states table alignment as a style; the visible result is the same.
      html.replace(/<(th|td) align="(left|right|center)">/g, '<$1 style="text-align: $2">'),
    ),
  );
}

/**
 * Headings get the ids Astro gave them (github-slugger over the heading's
 * text), so links to a section and the table of contents keep working.
 */
function withHeadingSlugs(html: string): string {
  const slugger = new Slugger();
  return html.replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g, (_, level: string, inner: string) => {
    const text = inner
      .replace(/<[^>]+>/g, "")
      .replace(/&(?:#(\d+)|#x([\da-f]+)|(\w+));/gi, (entity, dec, hex, name: string) =>
        dec
          ? String.fromCodePoint(Number(dec))
          : hex
            ? String.fromCodePoint(Number.parseInt(hex, 16))
            : (ENTITIES[`&${name};`] ?? entity),
      );
    return `<h${level} id="${slugger.slug(text)}">${inner}</h${level}>`;
  });
}

const BLOCK_TAGS = new Set([
  "address",
  "aside",
  "blockquote",
  "dd",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "li",
  "ol",
  "p",
  "section",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);
const OPAQUE_TAGS = new Set(["code", "pre", "script", "style"]);
const ENTITIES: Record<string, string> = {
  "&quot;": '"',
  "&#39;": "'",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
};
const PUNCTUATION_RE = /[\p{P}\p{S}]/u;
const SPACE_RE = /\s/u;

type Unit =
  | { kind: "text"; char: string; raw: string }
  /**
   * A tag inside running text, standing for the Markdown it came from: `[`
   * and `)` for a link, `*` for emphasis, a backtick for code. `before` is
   * what a quote right after it sees, `after` what a quote right before it sees.
   */
  | { kind: "mark"; raw: string; before: string; after: string };

/** The Markdown punctuation a rendered inline tag stood for. */
function markFor(raw: string, name: string | undefined): Unit {
  const closing = raw.startsWith("</");
  const [before, after] =
    name === "a"
      ? closing
        ? [")", ")"]
        : ["[", "["]
      : name === "img"
        ? [")", "!"]
        : name === "code"
          ? ["`", "`"]
          : name === "em" || name === "strong" || name === "del"
            ? ["*", "*"]
            : [">", "<"];
  return { kind: "mark", raw, before, after };
}

/**
 * Curly quotes, en/em dashes and ellipses, decided the way satteri decides
 * them: a quote opens or closes by what sits on either side of it (CommonMark
 * flanking), pairs within one block, and an apostrophe inside a word stays an
 * apostrophe. Code and tag attributes are left alone; image alt text is
 * treated as its own block, as satteri does.
 */
export function smartPunctuation(html: string): string {
  const out: string[] = [];
  let block: Unit[] = [];
  let opaque = 0;

  const flush = (): void => {
    out.push(convertBlock(block));
    block = [];
  };

  for (const part of html.split(/(<[^>]+>)/)) {
    if (part === "") continue;
    if (part.startsWith("<")) {
      const name = /^<\/?([a-zA-Z][\w-]*)/.exec(part)?.[1]?.toLowerCase();
      if (name && OPAQUE_TAGS.has(name)) {
        if (part.startsWith("</")) opaque = Math.max(0, opaque - 1);
        else opaque++;
        // A code span reads as its backticks from outside.
        block.push(markFor(part, name));
        continue;
      }
      if (opaque > 0) {
        block.push(markFor(part, "code"));
        continue;
      }
      if (name && BLOCK_TAGS.has(name)) {
        flush();
        out.push(part);
        continue;
      }
      if (name === "br") {
        block.push({ kind: "text", char: "\n", raw: part });
        continue;
      }
      block.push(markFor(name === "img" ? smartAlt(part) : part, name));
      continue;
    }
    if (opaque > 0) {
      block.push(markFor(part, "code"));
      continue;
    }
    for (const m of part.matchAll(/&(?:#\d+|#x[\da-f]+|\w+);|[\s\S]/giu)) {
      const raw = m[0];
      block.push({ kind: "text", char: ENTITIES[raw] ?? (raw.length > 1 ? "x" : raw), raw });
    }
  }
  flush();
  return out.join("");
}

function smartAlt(tag: string): string {
  return tag.replace(/\balt="([^"]*)"/, (_, alt: string) => {
    const converted = smartPunctuation(`<p>${alt}</p>`).slice(3, -4);
    return `alt="${converted.replaceAll('"', "&quot;")}"`;
  });
}

const isSpace = (unit: Unit | undefined): boolean =>
  unit?.kind === "text" && (unit.char === " " || unit.char === "\t");
const isBreak = (unit: Unit | undefined): boolean =>
  unit?.kind === "text" && unit.char === "\n" && unit.raw === "\n";

function convertBlock(input: Unit[]): string {
  // A paragraph's lines lose their leading and trailing spaces (CommonMark);
  // marked keeps them, satteri does not.
  const units = input.filter((unit, i) => {
    if (!isSpace(unit)) return true;
    let before = i - 1;
    while (isSpace(input[before])) before--;
    let after = i + 1;
    while (isSpace(input[after])) after++;
    return !(
      before < 0 ||
      after >= input.length ||
      isBreak(input[before]) ||
      isBreak(input[after])
    );
  });
  // The character a quote at `from` sees at `i`, reading marks as Markdown.
  const charAt = (i: number, from: number): string | undefined => {
    const unit = units[i];
    if (!unit) return undefined;
    if (unit.kind === "text") return unit.char;
    return i < from ? unit.before : unit.after;
  };
  const kindOf = (char: string | undefined): "space" | "punct" | "other" =>
    char === undefined || SPACE_RE.test(char)
      ? "space"
      : PUNCTUATION_RE.test(char)
        ? "punct"
        : "other";

  const replaced = new Map<number, string>();

  // Dashes and ellipses: runs inside text, never across a tag.
  for (let i = 0; i < units.length;) {
    const unit = units[i]!;
    if (unit.kind !== "text" || (unit.char !== "-" && unit.char !== ".")) {
      i++;
      continue;
    }
    let end = i;
    while (units[end]?.kind === "text" && (units[end] as { char: string }).char === unit.char)
      end++;
    const length = end - i;
    if (unit.char === "-" && length >= 2) {
      const dashes = dashRun(length);
      for (let k = i; k < end; k++) replaced.set(k, "");
      replaced.set(i, dashes);
    } else if (unit.char === "." && length >= 3) {
      for (let k = i; k + 2 < end; k += 3) {
        replaced.set(k, "…");
        replaced.set(k + 1, "");
        replaced.set(k + 2, "");
      }
    }
    i = end;
  }

  // Quotes: CommonMark delimiter matching, double quotes like `*`, single
  // quotes like `_` so an apostrophe inside a word never opens or closes.
  const openers: { index: number; char: string }[] = [];
  const paired = new Set<number>();
  for (let i = 0; i < units.length; i++) {
    const unit = units[i]!;
    if (unit.kind !== "text" || (unit.char !== '"' && unit.char !== "'")) continue;
    const previous = charAt(i - 1, i);
    const before = kindOf(previous);
    const after = kindOf(charAt(i + 1, i));
    const left = after !== "space" && (after !== "punct" || before !== "other");
    const right = before !== "space" && (before !== "punct" || after !== "other");
    const single = unit.char === "'";
    // Right after a link, a closing bracket or a digit (5'10"), a quote never opens.
    const blocked = previous !== undefined && /[)\]\d]/.test(previous);
    const canOpen = !blocked && (single ? left && (!right || before === "punct") : left);
    const canClose = single ? right && (!left || after === "punct") : right;
    if (canClose) {
      const at = openers.findLastIndex((opener) => opener.char === unit.char);
      if (at >= 0) {
        const opener = openers[at]!;
        // Openers between the pair can no longer close anything: plain quotes.
        for (const skipped of openers.splice(at)) {
          if (skipped !== opener) {
            replaced.set(skipped.index, skipped.char === "'" ? "’" : "“");
          }
        }
        replaced.set(opener.index, single ? "‘" : "“");
        replaced.set(i, single ? "’" : "”");
        paired.add(opener.index).add(i);
        continue;
      }
    }
    if (canOpen) openers.push({ index: i, char: unit.char });
    // A lone double quote leans the way it faces; after a digit it is a closing mark.
    else {
      const closing = (right && !left) || /\d/.test(previous ?? "");
      replaced.set(i, single ? "’" : closing ? "”" : "“");
    }
  }
  for (const opener of openers) {
    if (!paired.has(opener.index)) replaced.set(opener.index, opener.char === "'" ? "’" : "“");
  }

  return units.map((unit, i) => replaced.get(i) ?? unit.raw).join("");
}

/** satteri's split of a run of hyphens: all em, else all en, else em first. */
function dashRun(length: number): string {
  if (length % 3 === 0) return "—".repeat(length / 3);
  if (length % 2 === 0) return "–".repeat(length / 2);
  if (length % 3 === 2) return "—".repeat((length - 2) / 3) + "–";
  return "—".repeat((length - 4) / 3) + "––";
}

const escapeAttribute = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

/**
 * What an inline affiliate link says about itself. The body marks the link with
 * the Markdown title `"広告"` — `[ラベル](https://… "広告")` — and rendering
 * writes the rel and this note, so the editor never types HTML.
 */
export const INLINE_AFFILIATE_TITLE = "広告";
const DISCLOSURE =
  '<small class="affiliate-inline-disclosure">広告：このリンク経由の予約で当サイトが報酬を受け取る場合があります。料金・条件は予約先でご確認ください。</small>';

/**
 * Inline affiliate links use the same approved placements and kill switch as
 * the cards: a link to a URL not in `allowedUrls` keeps only its label.
 */
export function enhanceInlineAffiliates(html: string, allowedUrls: readonly string[]): string {
  const allowed = new Set(allowedUrls.flatMap((url) => [url, escapeAttribute(url)]));
  const disclosure = /<small\b[^>]*class="affiliate-inline-disclosure"[^>]*>[\s\S]*?<\/small>/gi;
  let approvedLinks = 0;
  const result = html.replace(/<(p|li)\b[^>]*>[\s\S]*?<\/\1>/gi, (block) => {
    let kept = 0;
    let titled = 0;
    const transformed = block.replace(
      /<a\b([^>]*)>([\s\S]*?)<\/a>/gi,
      (anchor, attributes: string, label: string) => {
        const href = /\bhref="([^"]*)"/i.exec(attributes)?.[1];
        const title = /\btitle="([^"]*)"/i.exec(attributes)?.[1];
        if (title === INLINE_AFFILIATE_TITLE) {
          if (!href || !allowed.has(href)) return label;
          approvedLinks++;
          kept++;
          titled++;
          return `<a href="${href}" rel="sponsored nofollow noopener">${label}</a>`;
        }
        // Bodies published before the title marker carry the rel and the note as HTML.
        const rel = /\brel="([^"]*)"/i.exec(attributes)?.[1] ?? "";
        if (!rel.split(/\s+/).includes("sponsored")) return anchor;
        if (!href || !allowed.has(href)) return label;
        approvedLinks++;
        kept++;
        return anchor;
      },
    );
    if (!kept) return transformed.replace(disclosure, "");
    if (!titled || transformed.includes('class="affiliate-inline-disclosure"')) return transformed;
    return transformed.replace(/<\/(p|li)>$/i, `\n${DISCLOSURE}</$1>`);
  });
  return approvedLinks ? result : result.replace(disclosure, "");
}

/**
 * A paragraph or list item holding one link and nothing else — the spot the
 * site turns into a link card when the link points at one of its own pages.
 */
export function replaceLoneLinks(
  html: string,
  replace: (href: string, label: string) => string | null,
): string {
  return html.replace(
    /<(p|li)>\s*<a href="([^"]+)"(?:\s[^>]*)?>(.*?)<\/a>\s*<\/\1>/gi,
    (match, _tag: string, href: string, label: string) => replace(href, label) ?? match,
  );
}

/** Text a reader must have passed before the in-body ad: a heading and this many characters. */
export const AD_MIN_INTRODUCTION_CHARS = 600;

/**
 * Characters a reader sees as text in a stretch of body: headings, paragraphs,
 * lists and tables as the page renders them. A photo, a link card, a music
 * player, a URL or Markdown syntax adds nothing, so none of them can stand in
 * for the reading the ad rule asks for.
 */
export function visibleTextLength(markdown: string): number {
  const html = replaceLoneLinks(
    renderArticleMarkdown(markdown.replace(/\{\{(?:embed|monetization):[^}\n]*\}\}/g, "")),
    () => "",
  );
  const text = html
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&(?:#\d+|#x[\da-f]+|\w+);/gi, "x");
  return text.replace(/\s/g, "").length;
}

/** The single rule for where an in-body ad may sit; the publish check and the admin both ask it. */
export function bodyAdPlacementProblem(
  before: string,
  after: string,
): "introduction" | "neighbour" | null {
  if (visibleTextLength(before) < AD_MIN_INTRODUCTION_CHARS || !/^## /m.test(before))
    return "introduction";
  const adjacent = `${
    before
      .trim()
      .split(/\n\s*\n/)
      .at(-1) ?? ""
  }\n${after.trim().split(/\n\s*\n/)[0] ?? ""}`;
  return /!\[|\{\{embed:|^\s*\[.+\]\(/m.test(adjacent) ? "neighbour" : null;
}

/** Where `suggestAdParagraph` would put the in-body ad. */
export interface AdPosition {
  offset: number;
  excerpt: string;
  fraction: number;
}
const unsafe = (raw: string) =>
  /!\[|\{\{(?:embed|monetization):|<\/?(?:img|figure|aside|iframe|video|script)|^\s*\[.+\]\(/im.test(
    raw,
  );
/**
 * Every top-level prose paragraph an in-body ad may follow, between `from`
 * and `to` of the way through the body: after the introduction and away from
 * images, cards and embeds.
 */
export function adParagraphCandidates(body: string, from = 0.3, to = 0.65): AdPosition[] {
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
    if (bodyAdPlacementProblem(before, body.slice(cursor)) === "introduction") continue;
    const fraction = cursor / body.length;
    if (fraction < from || fraction > to || token.raw.trim().length < 30) continue;
    candidates.push({ offset: cursor, excerpt: token.raw.trim().slice(-140), fraction });
  }
  return candidates;
}

/** Only top-level prose paragraphs, after the introduction and away from images/cards/embeds. */
export function suggestAdParagraph(body: string): AdPosition | null {
  return (
    adParagraphCandidates(body).toSorted(
      (a, b) => Math.abs(a.fraction - 0.4) - Math.abs(b.fraction - 0.4),
    )[0] ?? null
  );
}
