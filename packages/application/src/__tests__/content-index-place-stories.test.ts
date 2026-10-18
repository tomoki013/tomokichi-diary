import { describe, expect, it } from "vitest";
import { EMPTY_SNAPSHOT, type ContentSnapshot } from "@tomokichi/data";
import type {
  Article,
  ArticleRevision,
  Collection,
  Location,
  Place,
  Route,
} from "@tomokichi/domain";
import { ContentIndex, type ArticleView } from "../read/content-index.js";
import { sharesStoryPlace } from "../read/place-stories.js";

const NOW = "2026-10-18T00:00:00.000Z" as Article["updatedAt"];
const id = (value: string) => value as Article["id"];

function article(slug: string, status = "published"): Article {
  return {
    id: slug,
    kind: "article",
    status,
    locale: "ja",
    slug,
    authorId: "author",
    currentRevisionId: `r-${slug}`,
    publishedRevisionId: status === "published" ? `r-${slug}` : null,
    createdAt: NOW,
    updatedAt: NOW,
    scheduledAt: null,
    publishedAt: NOW,
    archivedAt: null,
    noindex: false,
    travelStartDate: null,
    travelEndDate: null,
    experienceTags: ["discovery"],
  } as unknown as Article;
}

function view(slug: string, bodyMarkdown = "", title = "旅の記録"): ArticleView {
  return {
    article: article(slug),
    revision: {
      id: `r-${slug}`,
      articleId: slug,
      title,
      summary: "",
      bodyMarkdown,
    } as ArticleRevision,
    route: {
      id: `route-${slug}`,
      path: `/posts/${slug}`,
      targetType: "article",
      targetId: slug,
      isCanonical: true,
    } as Route,
    author: null,
    embeds: [],
    cover: null,
    media: [],
    categories: [],
    tags: [],
    locations: [],
    places: [],
  };
}

const eiffel = view("eiffel-tower-artists-protest", "", "エッフェル塔の建設秘話");

function snapshot(
  stories: ArticleView[],
  source = view("diary", "エッフェル塔を眺めました。"),
): ContentSnapshot {
  const views = [source, view("ordinary", "パリのカフェ巡り"), ...stories];
  return {
    ...EMPTY_SNAPSHOT,
    articles: views.map((v) => v.article),
    revisions: views.map((v) => v.revision),
    routes: views.map((v) => v.route),
    collections: [
      { id: "series", kind: "series", slug: "travel-stories", title: "旅先の小話" } as Collection,
    ],
    articleCollections: stories.map((v, sortOrder) => ({
      articleId: v.article.id,
      collectionId: "series",
      sortOrder,
    })) as ContentSnapshot["articleCollections"],
    locations: [{ id: "france", slug: "france", type: "country", parentId: null } as Location],
    articleLocations: views.map((v) => ({
      articleId: v.article.id,
      locationId: "france",
      relation: "primary",
    })) as ContentSnapshot["articleLocations"],
  };
}

describe("same-place short stories", () => {
  it("matches concrete places in prose, including spelling variants and inline links", () => {
    expect(
      sharesStoryPlace(view("diary", "[エッフェル塔](https://example.com)を眺めました。"), eiffel),
    ).toBe(true);
    expect(
      sharesStoryPlace(
        view("diary", "ワット・アルンの塔を見上げました。"),
        view("wat-arun-porcelain-decoration"),
      ),
    ).toBe(true);
  });

  it("does not infer a landmark from a shared city or country", () => {
    const index = new ContentIndex(
      snapshot([eiffel], view("diary", "パリのカフェで昼食。", "フランス旅行")),
      NOW,
    );
    expect(index.placeStoriesFor(id("diary"))).toEqual([]);
  });

  it.each([
    "![エッフェル塔](https://example.com/photo.jpg)",
    "[エッフェル塔の記事はこちら](./eiffel-tower-artists-protest)",
    "## 関連記事\n\nエッフェル塔の話",
    "## 参考資料\n\nエッフェル塔公式サイト",
    "<!-- エッフェル塔 -->",
    "```text\nエッフェル塔\n```",
  ])("does not match navigation, images, citations or hidden content: %s", (body) => {
    expect(sharesStoryPlace(view("diary", body), eiffel)).toBe(false);
  });

  it("requires the rock scenery as well as Cappadocia, not just the region", () => {
    const story = view("cappadocia-fairy-chimneys");
    expect(sharesStoryPlace(view("diary", "カッパドキアのホテルに到着。"), story)).toBe(false);
    expect(sharesStoryPlace(view("diary", "カッパドキアのギョレメのホテルに到着。"), story)).toBe(
      false,
    );
    expect(sharesStoryPlace(view("diary", "カッパドキアで奇岩を眺めました。"), story)).toBe(true);
    expect(sharesStoryPlace(view("diary", "## カッパドキア\n\n奇岩を眺めました。"), story)).toBe(
      true,
    );
    expect(
      sharesStoryPlace(
        view("diary", "カッパドキアに泊まりました。\n\n## 別の街\n\n奇岩を見ました。"),
        story,
      ),
    ).toBe(false);
  });

  it("requires Santorini's subject scenery, not just an island or town mention", () => {
    const town = view("diary", "サントリーニ島のイアの街で昼食。イメロヴィグリへ移動。");
    expect(sharesStoryPlace(town, view("santorini-white-houses"))).toBe(false);
    expect(sharesStoryPlace(town, view("santorini-caldera-volcano"))).toBe(false);
    expect(
      sharesStoryPlace(
        view("diary", "サントリーニ島で白い街並みを歩く。"),
        view("santorini-white-houses"),
      ),
    ).toBe(true);
    expect(
      sharesStoryPlace(
        view("diary", "サントリーニ島でカルデラを眺める。"),
        view("santorini-caldera-volcano"),
      ),
    ).toBe(true);
  });

  it("distinguishes the Istanbul mosque from Malaysia's blue mosque", () => {
    const story = view("why-blue-mosque-is-blue");
    expect(sharesStoryPlace(view("diary", "シャーアラムのブルーモスクへ。"), story)).toBe(false);
    expect(sharesStoryPlace(view("diary", "イスタンブールのブルーモスクへ。"), story)).toBe(true);
    expect(sharesStoryPlace(view("diary", "スルタンアフメト・モスクへ。"), story)).toBe(true);
  });

  it("does not treat the Marina Bay Sands hotel as the reservoir", () => {
    const story = view("marina-bay-freshwater-reservoir");
    expect(
      sharesStoryPlace(view("diary", "マリーナ・ベイ・サンズを見た。Marina Bay Sands。"), story),
    ).toBe(false);
    expect(sharesStoryPlace(view("diary", "マリーナベイの水辺を散策。"), story)).toBe(true);
  });

  it("supports a future story through an explicit concrete CMS place", () => {
    const place = { id: "museum", name: "旅の博物館" } as Place;
    const story = {
      ...view("new-museum-story"),
      places: [{ place, relation: "primary" as const }],
    };
    expect(
      sharesStoryPlace(
        { ...view("diary"), places: [{ place, relation: "visited" as const }] },
        story,
      ),
    ).toBe(true);
    expect(sharesStoryPlace(view("diary", "旅の博物館へ。"), story)).toBe(true);
    expect(sharesStoryPlace(view("diary", "博物館のある街へ。"), story)).toBe(false);
  });

  it("returns only public stories, excludes itself and respects the editorial order and limit", () => {
    const index = new ContentIndex(
      snapshot(
        [
          { ...eiffel, article: article(eiffel.article.slug, "draft") },
          view("paris-concorde-luxor-obelisk"),
          view("arc-de-triomphe-remembrance-flame"),
        ],
        view("diary", "パリの凱旋門、コンコルド広場、エッフェル塔を訪れました。"),
      ),
      NOW,
    );
    expect(index.placeStoriesFor(id("diary")).map((v) => v.article.slug)).toEqual([
      "paris-concorde-luxor-obelisk",
      "arc-de-triomphe-remembrance-flame",
    ]);
    expect(index.placeStoriesFor(id("diary"), 1)).toHaveLength(1);
    expect(index.placeStoriesFor(id("paris-concorde-luxor-obelisk"))).toEqual([]);
  });

  it("uses the published source text, not an unpublished revision", () => {
    const data = snapshot([eiffel], view("diary", "パリのカフェへ。"));
    const source = data.articles[0]!;
    const index = new ContentIndex(
      {
        ...data,
        articles: data.articles.map((a) =>
          a.id === source.id
            ? { ...a, currentRevisionId: "new" as Article["currentRevisionId"] }
            : a,
        ),
        revisions: [
          ...data.revisions,
          {
            ...data.revisions[0]!,
            id: "new" as ArticleRevision["id"],
            bodyMarkdown: "エッフェル塔へ。",
          },
        ],
      },
      NOW,
    );
    expect(index.placeStoriesFor(source.id)).toEqual([]);
  });

  it("keeps short stories out of generic region/feeling recommendation rails", () => {
    const index = new ContentIndex(snapshot([eiffel]), NOW);
    for (const views of [
      index.relatedTo(id("diary")),
      index.sharingExperience(id("diary")),
      index.inSameCountry(id("diary")),
    ]) {
      expect(views.map((v) => v.article.slug)).toContain("ordinary");
      expect(views.map((v) => v.article.slug)).not.toContain(eiffel.article.slug);
    }
    expect(index.placeStoriesFor(id("diary")).map((v) => v.article.slug)).toEqual([
      eiffel.article.slug,
    ]);
  });
});
