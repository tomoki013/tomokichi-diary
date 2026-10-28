import { parseThemeMusic, type ThemeMusicPlayer } from "@tomokichi/contracts";
import type { Collection } from "@tomokichi/domain";
import { content } from "./content";

export interface SeriesMusicEntry {
  readonly slug: string;
  readonly title: string;
  readonly path: string;
  /** The label the admin gave the music, if any. */
  readonly musicTitle: string | null;
  readonly player: ThemeMusicPlayer;
}

/**
 * Series with music a reader can open: switched on, a URL the provider can
 * still play (checked again at build time, whatever the database holds), and
 * a public page with something to read. The export already carries only the
 * published memberships, so a draft's series never shows up here.
 */
export function seriesMusicOf(collections: readonly Collection[]): SeriesMusicEntry[] {
  return collections.flatMap((collection) => {
    const music = collection.themeMusic;
    if (collection.kind !== "series" || !music?.enabled) return [];
    const player = parseThemeMusic(music.provider, music.url);
    const route = content.routes.canonicalFor("series", collection.id);
    if (!player || !route || !content.hasPublicMembers(collection.id)) return [];
    return [
      {
        slug: collection.slug,
        title: collection.title,
        path: route.path,
        musicTitle: music.title,
        player,
      },
    ];
  });
}
