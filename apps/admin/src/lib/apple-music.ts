import { parseAppleMusicUrl } from "@tomokichi/contracts";

/**
 * Puts an Apple Music player into the body as its own paragraph: the share
 * URL on a line by itself, which the site and the preview render as Apple's
 * player. Accepts the share URL or Apple's `<iframe>` embed code; returns
 * null for anything that is not a song, album or playlist.
 */
export function insertAppleMusic(body: string, start: number, end: number, pasted: string) {
  const src = /\ssrc="([^"]+)"/i.exec(pasted)?.[1] ?? pasted.trim();
  const embed = parseAppleMusicUrl(src);
  if (!embed) return null;
  const line = embed.pageUrl;
  const before = body.slice(0, start);
  const after = body.slice(end);
  const prefix = before && !before.endsWith("\n\n") ? (before.endsWith("\n") ? "\n" : "\n\n") : "";
  const suffix = after && !after.startsWith("\n\n") ? (after.startsWith("\n") ? "\n" : "\n\n") : "";
  return {
    body: before + prefix + line + suffix + after,
    cursor: before.length + prefix.length + line.length,
    kind: embed.kind,
  };
}
