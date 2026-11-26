import type {
  AnalyticsArticleLabel,
  AnalyticsQueryIntentDto,
  AnalyticsThemeDto,
} from "@tomokichi/contracts";

const normalize = (text: string) => text.normalize("NFKC").toLowerCase().trim();
const BRAND =
  /chagee|チャジー|ちゃじー|チャギー|ちゃぎー|チャゲー|チャージー|[霸覇]王\s*茶\s*[姬姫]/u;
// Close to the brand but not it: never counted on either side.
const AMBIGUOUS = /\bchagea?\b|ちゃじ|チャージ|茶[姫姬]/u;
// Without the brand, a search is "non-CHAGEE" only when it is clearly about travel.
const TRAVEL =
  /空港|機内|航空|飛行機|搭乗|手荷物|保安検査|入国|出国|鉄道|地下鉄|電車|バス|タクシー|移動|フェリー|ホテル|宿泊|寺院|モスク|洞窟|博物館|美術館|宮殿|世界遺産|展望台|マッサージ|遺跡|観光|旅程|旅行|入場料|行き方|air(?:port|line)|metro|museum|temple|mosque|flight/u;

/** CHAGEE when the published title, path or a tag names it; unknown without a title. */
export function articleTheme(label: AnalyticsArticleLabel | undefined): AnalyticsThemeDto {
  if (!label?.title) return "unknown";
  return BRAND.test(normalize([label.path, label.title, ...label.tags].join(" ")))
    ? "chagee"
    : "non_chagee";
}

/**
 * brand: the name alone (chagee, チャジー, 霸王茶姬). chagee_specific: the name
 * plus a need (menu, order, store, a city...). non_chagee: a travel search
 * without the name. unknown: anything else, never folded into non_chagee.
 */
export function queryIntent(query: string): AnalyticsQueryIntentDto {
  const value = normalize(query);
  if (!/[\p{L}\p{N}]/u.test(value)) return "unknown";
  if (BRAND.test(value))
    return value.replace(new RegExp(BRAND.source, "gu"), "").trim() ? "chagee_specific" : "brand";
  return !AMBIGUOUS.test(value) && TRAVEL.test(value) ? "non_chagee" : "unknown";
}
