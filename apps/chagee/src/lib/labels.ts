import type {
  ColumnCategory,
  Country,
  MenuCategory,
  MilkType,
  NewsCategory,
  Sweetness,
  TeaBase,
  Temperature,
  Verification,
} from "./types";

export const COUNTRY_LABEL: Record<Country, string> = {
  cn: "中国本土",
  my: "マレーシア",
  sg: "シンガポール",
  th: "タイ",
  jp: "日本",
};

export const CATEGORY_LABEL: Record<MenuCategory, string> = {
  straight: "ストレートティー",
  milk: "ミルクティー",
  fruit: "フルーツ系",
  seasonal: "季節限定",
};

export const TEA_LABEL: Record<TeaBase, string> = {
  jasmine: "ジャスミン",
  oolong: "ウーロン",
  green: "緑茶",
  black: "紅茶",
  puer: "プーアル",
};

export const MILK_LABEL: Record<MilkType, string> = {
  "fresh-milk": "ミルクあり",
  none: "ミルクなし",
};

export const SWEETNESS_LABEL: Record<Sweetness, string> = {
  light: "控えめ",
  normal: "標準",
  sweet: "甘め",
};

export const TEMPERATURE_LABEL: Record<Temperature, string> = {
  iced: "アイス",
  hot: "ホット",
};

export const NEWS_CATEGORY_LABEL: Record<NewsCategory, string> = {
  japan: "日本上陸",
  product: "新商品",
  store: "新店舗",
  overseas: "海外ニュース",
  media: "メディア情報",
};

export const VERIFICATION_LABEL: Record<Verification, string> = {
  official: "公式発表",
  reported: "報道ベース",
  unverified: "噂・未確認",
};

export const COLUMN_CATEGORY_LABEL: Record<ColumnCategory, string> = {
  report: "体験レポート",
  menu: "メニュー紹介",
  travel: "旅行ガイド",
  compare: "比較・考察",
};

/** The color a tea brews to, used by the illustrated cup on menu cards. */
export const TEA_TINT: Record<TeaBase, string> = {
  jasmine: "#d9c48f",
  oolong: "#b9814f",
  green: "#a9b77a",
  black: "#8a4b33",
  puer: "#6e3b2a",
};

const DATE = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "Asia/Tokyo",
});

/** "2026-08-24" → "2026年8月24日". */
export function formatDate(iso: string): string {
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00+09:00` : iso);
  return Number.isNaN(date.getTime()) ? iso : DATE.format(date);
}
