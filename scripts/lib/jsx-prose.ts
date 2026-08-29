/**
 * Converts the prose JSX of the legacy static pages into Markdown.
 *
 * Scope is deliberately narrow: these pages are plain `h2`/`p`/`ul` content
 * with Tailwind classes, so a full JSX parser would be more risk than value.
 * Anything the converter does not recognise is reported rather than dropped
 * silently, so migration gaps stay visible.
 */
export interface ConversionResult {
  markdown: string;
  /** Component tags and expressions a human should review. */
  unknown: string[];
}

const BLOCK_TAGS = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "ul",
  "ol",
  "li",
  "blockquote",
  "hr",
  "br",
  "div",
  "section",
  "span",
  "strong",
  "b",
  "em",
  "i",
  "code",
  "a",
  "img",
]);

export function jsxProseToMarkdown(source: string): ConversionResult {
  const unknown = new Set<string>();

  let text = source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\{"\s*"\}/g, " ")
    .replace(/\{`([^`]*)`\}/g, "$1")
    .replace(/\{"([^"]*)"\}/g, "$1");

  // Remaining `{expression}` interpolations cannot be resolved outside the app.
  text = text.replace(/\{[^{}<>]+\}/g, (match) => {
    unknown.add(match.trim().slice(0, 60));
    return "";
  });

  // Links are rewritten before tokenising so the label and href stay together.
  text = text.replace(
    /<(?:a|Link)\b[^>]*?(?:href|to)="([^"]*)"[^>]*>([\s\S]*?)<\/(?:a|Link)>/g,
    (_match, href: string, label: string) =>
      `[${label
        .replace(/<[^>]*>/g, "")
        .replace(/\s+/g, " ")
        .trim()}](${href})`,
  );
  text = text.replace(/<(?:img|Image)\b([^>]*)\/?>/g, (_match, attrs: string) => {
    const src = /src="([^"]*)"/.exec(attrs)?.[1] ?? "";
    const alt = /alt="([^"]*)"/.exec(attrs)?.[1] ?? "";
    return src === "" ? "" : `\n\n![${alt}](${src})\n\n`;
  });

  const lines: string[] = [];
  const listStack: ("ul" | "ol")[] = [];
  let buffer = "";

  const flush = (): void => {
    const value = collapse(buffer);
    buffer = "";
    if (value !== "") lines.push(value, "");
  };

  for (const token of text.split(/(<[^>]+>)/)) {
    if (!token.startsWith("<")) {
      buffer += token;
      continue;
    }

    const closing = token.startsWith("</");
    const name = /^<\/?([A-Za-z][\w.]*)/.exec(token)?.[1] ?? "";
    const tag = name.toLowerCase();

    if (!BLOCK_TAGS.has(tag)) {
      // A layout component such as <Reveal>: drop the tag, keep its children.
      if (!closing && name !== "") unknown.add(`<${name}>`);
      continue;
    }

    switch (tag) {
      case "strong":
      case "b":
        buffer += "**";
        break;
      case "em":
      case "i":
        buffer += "_";
        break;
      case "code":
        buffer += "`";
        break;
      case "br":
        buffer += "\n";
        break;
      case "hr":
        flush();
        lines.push("---", "");
        break;
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6": {
        if (!closing) {
          flush();
          break;
        }
        const value = collapse(buffer);
        buffer = "";
        // The page title is rendered by the template, so body headings start at h2.
        if (value !== "") {
          if (lines.at(-1) !== "" && lines.length > 0) lines.push("");
          lines.push(`${"#".repeat(Math.max(2, Number(tag[1])))} ${value}`, "");
        }
        break;
      }
      case "ul":
      case "ol":
        if (closing) listStack.pop();
        else {
          flush();
          listStack.push(tag);
        }
        break;
      case "li": {
        if (!closing) {
          flush();
          break;
        }
        const value = collapse(buffer);
        buffer = "";
        if (value !== "") lines.push(`${listStack.at(-1) === "ol" ? "1." : "-"} ${value}`);
        break;
      }
      default:
        flush();
    }
  }
  flush();

  return {
    // A `{items.map(... => (` expression leaves its closing punctuation behind
    // once the interpolation is dropped; those fragments are not content.
    markdown: lines
      .join("\n")
      .split("\n")
      .filter((line) => !/^[\s(){}[\]<>;,)]*$/.test(line) || line === "")
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    unknown: [...unknown],
  };
}

function collapse(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s+([、。」）])/g, "$1")
    .replace(/([「（])\s+/g, "$1")
    .trim();
}
