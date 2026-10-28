/** Insert a photo as its own paragraph, preserving the text around the selection. */
export function insertMarkdownImage(
  body: string,
  start: number,
  end: number,
  url: string,
  alt: string,
) {
  const before = body.slice(0, start);
  const after = body.slice(end);
  const label = alt
    .replaceAll("\\", "\\\\")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]")
    .replaceAll(/\r?\n/g, " ");
  const destination = url
    .replaceAll("<", "%3C")
    .replaceAll(">", "%3E")
    .replaceAll(/\s/g, (c) => encodeURIComponent(c));
  const image = `![${label}](<${destination}>)`;
  const prefix = before && !before.endsWith("\n\n") ? (before.endsWith("\n") ? "\n" : "\n\n") : "";
  const suffix = after && !after.startsWith("\n\n") ? (after.startsWith("\n") ? "\n" : "\n\n") : "";
  return {
    body: before + prefix + image + suffix + after,
    cursor: before.length + prefix.length + image.length,
  };
}

// `![alt](url)` or `![alt](<url> "title")`, alt allowing escaped brackets.
const MARKDOWN_IMAGE = /!\[((?:\\.|[^\]\\])*)\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\s*\)/g;

/**
 * Removes every image showing one of `urls` from a body, with the blank lines
 * left behind, so taking a photo off an article also takes it out of the text.
 */
export function removeMarkdownImages(body: string, urls: readonly string[]) {
  const targets = new Set(urls.filter(Boolean));
  let removed = 0;
  const next = body.replace(MARKDOWN_IMAGE, (whole, _alt: string, written: string) => {
    const url = written.startsWith("<") ? written.slice(1, -1) : written;
    if (!targets.has(url)) return whole;
    removed++;
    return "";
  });
  if (removed === 0) return { body, removed };
  return {
    body: next
      .replaceAll(/[ \t]+$/gm, "")
      .replaceAll(/\n{3,}/g, "\n\n")
      .replace(/^\n+/, "")
      // Keep the body's own ending rather than the gap the image left.
      .replace(/\n*$/, /\n*$/.exec(body)?.[0] ?? ""),
    removed,
  };
}
