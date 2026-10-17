/**
 * Apple Music embeds in article bodies.
 *
 * The body stays plain Markdown (ADR 0001): an author pastes either the share
 * URL from the Music app on a line of its own, or the `<iframe>` embed code
 * Apple's "Embed" menu produces. Both are normalised into one player built
 * here, so the only frame a body can ever render is Apple's own player at
 * `embed.music.apple.com`, with our attributes, whatever was pasted.
 *
 * Shared by the public site (rendering), the admin (preview and the insert
 * button) and the publish check (rejecting a URL that is not a player).
 */

export type AppleMusicKind = "song" | "album" | "playlist";

export interface AppleMusicEmbed {
  readonly kind: AppleMusicKind;
  /** The player URL on embed.music.apple.com. */
  readonly embedUrl: string;
  /** The listening URL on music.apple.com, for the fallback link. */
  readonly pageUrl: string;
  /** Apple's own player heights: compact for one track, full for a list. */
  readonly height: number;
}

const HOSTS = new Set(["music.apple.com", "embed.music.apple.com", "geo.music.apple.com"]);
const STOREFRONT = /^[a-z]{2}$/;
const ID = /^(?:\d+|pl\.[A-Za-z0-9._-]+)$/;
const SONG_HEIGHT = 175;
const LIST_HEIGHT = 450;

/**
 * Parses an Apple Music share or embed URL. Songs come as `/song/<name>/<id>`
 * or as an album URL with `?i=<trackId>`; playlists as `/playlist/<name>/pl.…`.
 * Anything else (artists, stations, other hosts) is not embeddable and gives
 * null rather than a guess.
 */
export function parseAppleMusicUrl(input: string): AppleMusicEmbed | null {
  let url: URL;
  try {
    url = new URL(input.trim().replaceAll("&amp;", "&"));
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !HOSTS.has(url.hostname)) return null;

  const parts = url.pathname.split("/").filter(Boolean);
  const [storefront, type] = parts;
  if (!storefront || !STOREFRONT.test(storefront) || !type) return null;
  const id = parts.at(-1) ?? "";
  if (!ID.test(id) || parts.length < 3 || parts.length > 4) return null;
  const name = parts.length === 4 ? parts[2]! : "";
  if (!/^[^/?#]*$/.test(name)) return null;

  const trackId = url.searchParams.get("i");
  let kind: AppleMusicKind;
  if (type === "song") kind = "song";
  else if (type === "album") kind = trackId && /^\d+$/.test(trackId) ? "song" : "album";
  else if (type === "playlist") kind = "playlist";
  else return null;
  if (kind === "playlist" ? !id.startsWith("pl.") : !/^\d+$/.test(id)) return null;

  const path = `/${storefront}/${type}/${name ? `${encodeURIComponent(decodeURIComponent(name))}/` : ""}${id}`;
  const query = type === "album" && kind === "song" ? `?i=${trackId}` : "";
  return {
    kind,
    embedUrl: `https://embed.music.apple.com${path}${query}`,
    pageUrl: `https://music.apple.com${path}${query}`,
    height: kind === "song" ? SONG_HEIGHT : LIST_HEIGHT,
  };
}

const escapeAttribute = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const LABEL: Record<AppleMusicKind, string> = {
  song: "曲",
  album: "アルバム",
  playlist: "プレイリスト",
};

/**
 * The player. Lazy, so a playlist further down never costs the first view
 * anything; sandboxed to what Apple's player needs to play and to open the
 * Music app on a tap. A link stays inside for readers whose browser blocks
 * third-party frames.
 */
export function appleMusicPlayerHtml(embed: AppleMusicEmbed): string {
  const label = `Apple Musicの${LABEL[embed.kind]}`;
  return (
    `<figure class="apple-music apple-music--${embed.kind}">` +
    `<iframe src="${escapeAttribute(embed.embedUrl)}" title="${label}" height="${embed.height}" ` +
    `loading="lazy" allow="autoplay *; encrypted-media *; clipboard-write" ` +
    `sandbox="allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation" ` +
    `referrerpolicy="strict-origin-when-cross-origin"></iframe>` +
    `<figcaption><a href="${escapeAttribute(embed.pageUrl)}" target="_blank" rel="noopener noreferrer">${label}を開く</a></figcaption>` +
    `</figure>`
  );
}

// A paragraph that is only an Apple Music link: the URL pasted bare (GFM
// autolinks it) or as a Markdown link whose text is the URL itself.
const LINK_PARAGRAPH =
  /<p>\s*(?:<a\s+href="(https:\/\/(?:embed\.|geo\.)?music\.apple\.com\/[^"]+)"[^>]*>[^<]*<\/a>|(https:\/\/(?:embed\.|geo\.)?music\.apple\.com\/[^\s<]+))\s*<\/p>/gi;
// Apple's embed code, kept as raw HTML by the Markdown renderer, possibly
// wrapped in a paragraph.
const IFRAME = /(?:<p>\s*)?<iframe\b[^>]*\ssrc="([^"]+)"[^>]*>\s*<\/iframe>(?:\s*<\/p>)?/gi;

/**
 * Rewrites rendered body HTML: every Apple Music link paragraph and every
 * Apple embed `<iframe>` becomes our player. Other frames are left as they
 * were; the publish check reports an Apple Music URL that cannot be played.
 */
export function enhanceAppleMusic(html: string): string {
  return html
    .replace(IFRAME, (match, src: string) => {
      const embed = parseAppleMusicUrl(src);
      return embed ? appleMusicPlayerHtml(embed) : match;
    })
    .replace(LINK_PARAGRAPH, (match, href: string | undefined, bare: string | undefined) => {
      const embed = parseAppleMusicUrl(href ?? bare ?? "");
      return embed ? appleMusicPlayerHtml(embed) : match;
    });
}

/** Lines of a Markdown body that look like an Apple Music embed but cannot be played. */
export function invalidAppleMusicReferences(markdown: string): string[] {
  const body = markdown.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, "");
  const candidates = [
    ...[...body.matchAll(/<iframe\b[^>]*\ssrc="([^"]+)"/gi)]
      .map((m) => m[1]!)
      .filter((src) => /^https:\/\/(?:embed\.|geo\.)?music\.apple\.com\//i.test(src)),
    ...[
      ...body.matchAll(/^\s*<?(https:\/\/(?:embed\.|geo\.)?music\.apple\.com\/\S+?)>?\s*$/gim),
    ].map((m) => m[1]!),
  ];
  return candidates.filter((url) => parseAppleMusicUrl(url) === null);
}
