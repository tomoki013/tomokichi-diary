/**
 * Order for the gallery wall and the photographs behind its title.
 *
 * Nobody ranks 400 photographs by hand, and the order articles were written in
 * put airport lounges and in-flight meals first. Each photograph gets a score
 * from what is already known about it: what its alt text says it shows, what
 * the article is tagged with, and whether the file looks like a photograph at
 * all (screenshots and video frames are PNGs or phone-screen tall). The order
 * is then spread so one article does not fill a row.
 */

export interface GalleryCandidate {
  readonly key: string;
  readonly articleId: string;
  readonly role: string;
  readonly alt: string;
  readonly mimeType: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly tags: readonly string[];
}

/** What a reader looks at a gallery for: places, light, buildings. */
const SCENIC_WORDS = [
  "夕日",
  "夕陽",
  "夕景",
  "夕暮れ",
  "朝日",
  "日の出",
  "夜景",
  "絶景",
  "景色",
  "眺め",
  "全景",
  "神殿",
  "寺",
  "大聖堂",
  "教会",
  "モスク",
  "宮殿",
  "遺跡",
  "城",
  "塔",
  "気球",
  "海岸",
  "ビーチ",
  "湖",
  "川",
  "港",
  "旧市街",
  "街並み",
  "路地",
  "庭園",
  "ライトアップ",
];

/** The practical shots: useful in an article, not something to linger on. */
const PRACTICAL_WORDS = [
  "空港",
  "機内",
  "ラウンジ",
  "搭乗",
  "チケット",
  "料金",
  "地図",
  "看板",
  "案内",
  "画面",
  "メニュー",
  "レシート",
  "改札",
  "時刻表",
  "券売機",
  "予約",
  "パスポート",
  "入国",
  "両替",
  "ATM",
  "スクリーンショット",
];

const FOOD_WORDS = ["料理", "ご飯", "ランチ", "ディナー", "朝食", "夕食", "カレー", "スープ"];

const PRACTICAL_TAGS = new Set([
  "空港ラウンジ",
  "空港アクセス",
  "交通",
  "交通情報",
  "お金・決済",
  "キャッシュレス",
  "予約",
  "鉄道予約",
  "ビザ",
  "液体持ち込み",
  "会員特典",
  "Googleマップ",
  "Omio",
  "バス",
  "長距離移動",
  "スペイン高速鉄道",
]);

const SCENIC_TAGS = new Set(["観光スポット", "街歩き", "紅葉", "気球", "絶景"]);

const has = (text: string, words: readonly string[]) => words.some((word) => text.includes(word));

export function scorePhoto(photo: GalleryCandidate): number {
  let score = 0;
  // The author already picked the cover as the article's best frame.
  if (photo.role === "cover") score += 2;

  const practical = has(photo.alt, PRACTICAL_WORDS);
  if (practical) score -= 3;
  // Strip the practical words first so 空港 does not read as 港.
  const rest = PRACTICAL_WORDS.reduce((text, word) => text.replaceAll(word, ""), photo.alt);
  if (has(rest, SCENIC_WORDS)) score += 3;
  if (has(photo.alt, FOOD_WORDS)) score -= 1;

  if (photo.tags.some((tag) => PRACTICAL_TAGS.has(tag))) score -= 2;
  if (photo.tags.some((tag) => SCENIC_TAGS.has(tag))) score += 1;

  // Screenshots and frames pulled from phone video.
  if (photo.mimeType === "image/png") score -= 4;
  const { width, height } = photo;
  if (width && height) {
    if (Math.max(width, height) < 700) score -= 2;
    if (height / width > 1.9) score -= 2;
  }
  return score;
}

/**
 * Highest score first, ties kept in their original order, then spread: each
 * pick avoids the articles of the two before it when anything else is left.
 */
export function rankGallery<T extends GalleryCandidate>(photos: readonly T[]): T[] {
  const remaining = photos
    .map((photo, index) => ({ photo, index, score: scorePhoto(photo) }))
    .toSorted((a, b) => b.score - a.score || a.index - b.index);
  const ranked: T[] = [];
  while (remaining.length > 0) {
    const recent = new Set(ranked.slice(-2).map((photo) => photo.articleId));
    const at = remaining.findIndex((entry) => !recent.has(entry.photo.articleId));
    const [next] = remaining.splice(at === -1 ? 0 : at, 1);
    ranked.push(next!.photo);
  }
  return ranked;
}

/** Wide enough to fill a phone-width band without upscaling. */
const HERO_MIN_WIDTH = 1000;

/**
 * The frames behind the title: the best landscape photographs on the wall,
 * one per article so the band moves between trips.
 */
export function pickHeroPhotos<T extends GalleryCandidate>(ranked: readonly T[], count = 10): T[] {
  const seen = new Set<string>();
  const picks: T[] = [];
  for (const photo of ranked) {
    if (picks.length === count) break;
    const { width, height } = photo;
    if (!width || !height || width < HERO_MIN_WIDTH || width < height * 1.2) continue;
    if (scorePhoto(photo) <= 0 || seen.has(photo.articleId)) continue;
    seen.add(photo.articleId);
    picks.push(photo);
  }
  return picks;
}
