import { parseAppleMusicUrl, type AppleMusicKind } from "./apple-music.js";

/**
 * Series theme music: the share URL a series names, resolved into the
 * provider's own player. Shared by the API (rejecting a URL before it is
 * stored), the admin (checking and previewing as it is typed) and the public
 * site (building the player only after a reader asks for it).
 *
 * Only Apple Music exists. Another service is one entry in `PARSERS` plus its
 * player; nothing else in the chain knows which provider it is handling.
 */
export type ThemeMusicProviderId = "apple_music";

export interface ThemeMusicPlayer {
  readonly provider: ThemeMusicProviderId;
  readonly kind: AppleMusicKind;
  /** The provider's player URL, loaded into a frame on the reader's request. */
  readonly embedUrl: string;
  /** The listening page, for readers whose browser cannot show the player. */
  readonly pageUrl: string;
  /** The provider's own player height, reserved so the page does not jump. */
  readonly height: number;
}

export const THEME_MUSIC_PROVIDER_LABELS: Record<ThemeMusicProviderId, string> = {
  apple_music: "Apple Music",
};

const PARSERS: Record<ThemeMusicProviderId, (url: string) => ThemeMusicPlayer | null> = {
  apple_music: (url) => {
    // Apple's "Embed" code is accepted as well as the share URL; only its
    // `src` is kept, never the markup.
    const src = /\ssrc="([^"]+)"/i.exec(url)?.[1] ?? url;
    const embed = parseAppleMusicUrl(src);
    return embed ? { provider: "apple_music", ...embed } : null;
  },
};

/** The player for a provider and URL, or null when the URL is not one it can play. */
export function parseThemeMusic(provider: string, url: string): ThemeMusicPlayer | null {
  if (!Object.hasOwn(PARSERS, provider) || url.length > 2000) return null;
  return PARSERS[provider as ThemeMusicProviderId](url.trim());
}
