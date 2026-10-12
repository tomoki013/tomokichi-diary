/**
 * Site facts in one place. Metadata, OGP, JSON-LD, robots, sitemap and
 * llms.txt all read from here (Web Baseline: site config is the single source).
 */
export const SITE = {
  name: "CHAGEE日本語ガイド",
  nameEn: "CHAGEE Japan Fan Guide",
  /** Always shown next to the name: this is a fan site, not the brand. */
  status: "非公式ファンガイド",
  tagline: "上海でCHAGEEにハマった「ともきちの旅行日記」がお送りする、非公式のCHAGEE日本語サイト",
  description:
    "CHAGEE（霸王茶姬）のメニュー図鑑、海外での注文方法、実際に行った店舗、最新情報を日本語でまとめた非公式ファンガイド。上海でハマり、マレーシア・シンガポールでも飲み歩いた「ともきちの旅行日記」が運営しています。",
  url: "https://chagee.tomokichidiary.com",
  locale: "ja_JP",
  author: "ともきち",
  publisher: "ともきちの旅行日記",
  blogUrl: "https://tomokichidiary.com",
  /** Shown wherever a reader might mistake the site for the brand's own. */
  disclaimer:
    "本サイトはCHAGEE（霸王茶姬）の公式サイトではなく、CHAGEEおよび関連企業とは一切関係のない個人運営のファンガイドです。",
} as const;

export const NAV = [
  { href: "/menu", label: "メニュー図鑑" },
  { href: "/order", label: "注文ガイド" },
  { href: "/stores", label: "店舗" },
  { href: "/news", label: "最新情報" },
  { href: "/columns", label: "体験レポート" },
] as const;
