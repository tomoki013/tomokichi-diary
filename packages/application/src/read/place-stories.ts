import type { ArticleView } from "./content-index.js";

export const PLACE_STORIES_SERIES_SLUG = "travel-stories";

/** Editorial subjects: a city/country tag alone never establishes a match. */
const subjects: readonly {
  slugs: readonly string[];
  names: readonly string[];
  context?: readonly string[];
}[] = [
  { slugs: ["eiffel-tower-artists-protest"], names: ["エッフェル塔", "Eiffel Tower"] },
  {
    slugs: ["santorini-white-houses"],
    names: ["白い街並み", "白い町並み", "白壁の家", "白い家", "白い建物"],
    context: ["サントリーニ", "Santorini"],
  },
  {
    slugs: ["giza-pyramid-white-casing"],
    names: [
      "ギザのピラミッド",
      "クフ王のピラミッド",
      "ギザの大ピラミッド",
      "Great Pyramid of Giza",
    ],
  },
  {
    slugs: ["abu-simbel-sun-alignment", "abu-simbel-temple-relocation"],
    names: ["アブシンベル神殿", "アブシンベル大神殿", "Abu Simbel temple"],
  },
  { slugs: ["parthenon-sculptures-colours"], names: ["パルテノン", "Parthenon"] },
  {
    slugs: ["santorini-caldera-volcano"],
    names: ["カルデラ", "火山", "断崖"],
    context: ["サントリーニ", "Santorini"],
  },
  { slugs: ["barcelona-chamfered-corners"], names: ["アシャンプラ", "エイシャンプラ", "Eixample"] },
  {
    slugs: ["sagrada-familia-facade-stories"],
    names: ["サグラダファミリア", "Sagrada Familia", "Sagrada Família"],
  },
  { slugs: ["paris-concorde-luxor-obelisk"], names: ["コンコルド広場", "Place de la Concorde"] },
  {
    slugs: ["arc-de-triomphe-remembrance-flame"],
    names: ["凱旋門", "Arc de Triomphe"],
    context: ["パリ", "Paris", "エトワール", "シャンゼリゼ", "エッフェル塔"],
  },
  {
    slugs: ["cappadocia-fairy-chimneys"],
    names: ["奇岩", "妖精の煙突", "fairy chimneys", "ギョレメ国立公園", "Göreme National Park"],
    context: ["カッパドキア", "Cappadocia"],
  },
  {
    slugs: ["why-blue-mosque-is-blue"],
    names: ["ブルーモスク", "スルタンアフメトモスク", "Sultanahmet Mosque"],
    context: ["イスタンブール", "Istanbul", "スルタンアフメト", "Sultanahmet"],
  },
  { slugs: ["jaipur-pink-city-history"], names: ["ピンクシティ", "ハワーマハル", "Hawa Mahal"] },
  {
    slugs: ["taj-mahal-off-centre-cenotaph", "taj-mahal-mumtaz-memorial"],
    names: ["タージマハル", "Taj Mahal"],
  },
  { slugs: ["shanghai-bund-western-architecture"], names: ["外灘", "The Bund"] },
  { slugs: ["wat-arun-porcelain-decoration"], names: ["ワットアルン", "Wat Arun"] },
  { slugs: ["bali-canang-sari-offerings"], names: ["チャナンサリ", "チャナン", "Canang Sari"] },
  {
    slugs: ["petronas-towers-islamic-design"],
    names: ["ペトロナスツインタワー", "Petronas Twin Towers"],
  },
  { slugs: ["merlion-lion-fish-origin"], names: ["マーライオン", "Merlion"] },
  {
    slugs: ["marina-bay-freshwater-reservoir"],
    names: ["マリーナベイ", "Marina Bay", "マリーナ貯水池", "Marina Reservoir", "マリーナバラージ"],
  },
];

const normalize = (value: string) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s・･]/g, "");

/** Navigation, citations, image alt text and URLs are not mentions in the story. */
function storyPassages(view: ArticleView): string[] {
  const body = view.revision.bodyMarkdown
    .replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*$/gm, "")
    .replace(/^~~~[^\n]*\n[\s\S]*?^~~~[^\n]*$/gm, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^#{1,6}\s+(?:参考資料|参考文献|出典|関連記事|あわせて読みたい)[^\n]*[\s\S]*$/m, "")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/^\s*(?:[-*]\s+)?\[[^\]]+\]\([^)]+\)\s*$/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/https?:\/\/\S+/g, "");
  const headings: string[] = [];
  const passages = [normalize(view.revision.title)];
  for (const paragraph of body.split(/\n\s*\n/)) {
    const heading = /^(#{1,6})\s+(.+)/.exec(paragraph);
    if (heading) {
      headings.length = heading[1]!.length;
      headings[heading[1]!.length - 1] = heading[2]!;
    }
    passages.push(normalize([view.revision.title, ...headings, paragraph].join("\n")));
  }
  return passages;
}

const mentions = (text: string, name: string): boolean => {
  const normalized = normalize(name);
  // The hotel name alone is not a reference to the bay/reservoir.
  if (["マリーナベイ", "marinabay"].includes(normalized)) {
    return text.replace(/マリーナベイサンズ|marinabaysands/g, "").includes(normalized);
  }
  return text.includes(normalized);
};

export function sharesStoryPlace(source: ArticleView, story: ArticleView): boolean {
  const ownPlaces = new Set(source.places.map(({ place }) => place.id));
  if (story.places.some(({ place }) => ownPlaces.has(place.id))) return true;
  const passages = storyPassages(source);
  const subject = subjects.find((entry) => entry.slugs.includes(story.article.slug));
  if (subject) {
    return passages.some(
      (text) =>
        (!subject.context || subject.context.some((name) => mentions(text, name))) &&
        subject.names.some((name) => mentions(text, name)),
    );
  }
  // Future stories can opt in through a concrete CMS place; never infer from regions.
  return story.places.some(({ place }) => passages.some((text) => mentions(text, place.name)));
}
