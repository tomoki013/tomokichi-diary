import type { ArticleView } from "@tomokichi/application";
import type { ExperienceTag } from "@tomokichi/domain";
import { content } from "./content";

/**
 * Home-page curation. Which stories the home page leads with is an editorial
 * choice about the *page*, not a fact about the articles, so it lives here
 * rather than in article metadata (docs/EDITORIAL.md). Articles are named by
 * slug; one that is missing or unpublished simply drops out.
 */

export interface BestEpisode {
  readonly slug: string;
  /** The line the home page shows instead of the article title — a hook, not an SEO title. */
  readonly featuredTitle: string;
  /** One or two sentences in the author's voice on why this one comes first. */
  readonly hook: string;
}

/** "Read these first." The first entry leads, and all of them feed the hero slides. */
export const BEST_EPISODES: readonly BestEpisode[] = [
  {
    slug: "turkey3",
    featuredTitle: "気球の上で迎えた、一生モノの朝",
    hook: "夜明け前に飛び立った気球の上で、静かなサンライズを見た。その数時間後、カイロ空港で強烈な客引きに囲まれるとは知らずに。",
  },
  {
    slug: "egypt4",
    featuredTitle: "アスワンで、逃げ場のない島へ連れて行かれかけた日",
    hook: "配車アプリが捕まらず、やっと乗れたトゥクトゥク。ナビと逆方向へ走り出し、頼んでもいないボートでナイル川の島へ。",
  },
  {
    slug: "india5",
    featuredTitle: "スコールに背中を押されて、ガンジス川へ",
    hook: "前日のスコールでずぶ濡れになった勢いのまま、水位の上がったガンジス川へ。現地の人に作法を教わりながら身を沈めた一日。",
  },
  {
    slug: "travel-history1",
    featuredTitle: "日本の当たり前が、一気に崩れた日",
    hook: "初めての海外、バンコク。駅を出た瞬間の第一印象は「臭い、汚い、暑い」、そして「帰りたい」。それでも、ここから海外旅行にハマっていった。",
  },
];

export interface Selection {
  readonly id: string;
  readonly title: string;
  /** A handwritten-style aside next to the title. */
  readonly note: string;
  /** Linked from the selection's "more" link, so a pick can grow into a full list. */
  readonly experience: ExperienceTag | null;
  /** Ranked: first is #1. */
  readonly slugs: readonly string[];
}

/** Rankings cut by how a trip felt to the author — never by popularity or page views. */
export const SELECTIONS: readonly Selection[] = [
  {
    id: "moving",
    title: "心が震えた景色",
    note: "写真じゃ足りなかった",
    experience: "moving",
    slugs: ["greece2", "india2", "egypt2"],
  },
  {
    id: "thrilling",
    title: "いちばんハラハラした日",
    note: "今だから笑える",
    experience: "thrilling",
    slugs: ["india1", "greece3", "thai4"],
  },
  {
    id: "again",
    title: "また行きたい街",
    note: "次は長めに滞在したい",
    experience: null,
    slugs: ["spain4", "malaysia-night-vibes", "spain6"],
  },
  {
    id: "food",
    title: "ごはんが忘れられない旅",
    note: "思い出すとお腹がすく",
    experience: null,
    slugs: ["thai2", "hokkaido2", "spain3"],
  },
];

const viewBySlug = (slug: string): ArticleView | null =>
  content.articleViews().find((view) => view.article.slug === slug) ?? null;

export function bestEpisodes(): { episode: BestEpisode; view: ArticleView }[] {
  return BEST_EPISODES.flatMap((episode) => {
    const view = viewBySlug(episode.slug);
    return view ? [{ episode, view }] : [];
  });
}

export function selections(): { selection: Selection; views: ArticleView[] }[] {
  return SELECTIONS.map((selection) => ({
    selection,
    views: selection.slugs.flatMap((slug) => viewBySlug(slug) ?? []),
  })).filter((entry) => entry.views.length > 0);
}
