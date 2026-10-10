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
