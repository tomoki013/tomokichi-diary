import type { ArticleView } from "@tomokichi/application";
import type { Ranking } from "@tomokichi/domain";
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

/** "Read these first." The first entry leads the episode carousel. */
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

/** Hero photographs are chosen independently of the episode cards. */
export const HERO_STORIES: readonly (BestEpisode & {
  readonly photo?: { readonly storageKey: string; readonly alt: string };
})[] = [
  {
    slug: "turkey3",
    featuredTitle: "カッパドキアの朝、空いっぱいの気球",
    hook: "夜明けの空に浮かぶ気球。カッパドキアで迎えた、忘れられない朝の話。",
    photo: {
      storageKey: "images/Turkey/balloons-in-cappadocia.jpg",
      alt: "カッパドキアの街と朝の空に浮かぶたくさんの気球",
    },
  },
  {
    slug: "greece2",
    featuredTitle: "2時間待って出会った、イアの夕日",
    hook: "白い街並みが夕日に染まるまで。場所取りの疲れも吹き飛んだ、サントリーニの夕暮れ。",
    photo: {
      storageKey: "images/Greece/oia-castle-sunset-view2.jpg",
      alt: "海に沈む夕日とオレンジ色に染まるイアの白い街並み",
    },
  },
  {
    slug: "malaysia1",
    featuredTitle: "屋台の熱気に、旅のスイッチが入った夜",
    hook: "提灯の下に人も屋台もひしめくアロー通り。クアラルンプールの最初の夜は、ここから始まった。",
    photo: {
      storageKey: "images/Malaysia/people-enjoying-the-food-stalls-along-arrow-street-at-night.jpg",
      alt: "赤い提灯と明るい屋台が並び、人々でにぎわう夜のアロー通り",
    },
  },
  ...BEST_EPISODES.filter((episode) => ["egypt4", "india5"].includes(episode.slug)),
];

export function heroStories() {
  return HERO_STORIES.flatMap((story) => {
    const view = viewBySlug(story.slug);
    const photo =
      story.photo ??
      (view?.cover ? { storageKey: view.cover.asset.storageKey, alt: view.cover.usage.alt } : null);
    if (
      !view ||
      !photo ||
      !content.snapshot.media.some((asset) => asset.storageKey === photo.storageKey)
    )
      return [];
    return [{ view, title: story.featuredTitle, hook: story.hook, photo }];
  });
}

const viewBySlug = (slug: string): ArticleView | null =>
  content.articleViews().find((view) => view.article.slug === slug) ?? null;

export function bestEpisodes(): { episode: BestEpisode; view: ArticleView }[] {
  return BEST_EPISODES.flatMap((episode) => {
    const view = viewBySlug(episode.slug);
    return view ? [{ episode, view }] : [];
  });
}

/**
 * "ともきち的ランキング": edited in the admin and read from the snapshot. A pick
 * whose article is not public drops out; a ranking left with no picks is not shown.
 */
export function selections(): {
  selection: Ranking;
  picks: { view: ArticleView; comment: string }[];
}[] {
  const viewById = new Map(content.articleViews().map((view) => [view.article.id, view]));
  return (content.snapshot.rankings ?? [])
    .toSorted((a, b) => a.sortOrder - b.sortOrder)
    .map((selection) => ({
      selection,
      picks: selection.picks.flatMap(({ articleId, comment }) => {
        const view = viewById.get(articleId);
        return view ? [{ view, comment }] : [];
      }),
    }))
    .filter((entry) => entry.picks.length > 0);
}
