/** Domain types for the CHAGEE guide. Plain TypeScript: no Astro, no Cloudflare. */

export const COUNTRIES = ["cn", "my", "sg", "th", "jp"] as const;
export type Country = (typeof COUNTRIES)[number];

export const MENU_CATEGORIES = ["straight", "milk", "fruit", "seasonal"] as const;
export type MenuCategory = (typeof MENU_CATEGORIES)[number];

export const TEA_BASES = ["jasmine", "oolong", "green", "black", "puer"] as const;
export type TeaBase = (typeof TEA_BASES)[number];

export const MILK_TYPES = ["fresh-milk", "none"] as const;
export type MilkType = (typeof MILK_TYPES)[number];

export const SWEETNESS = ["light", "normal", "sweet"] as const;
export type Sweetness = (typeof SWEETNESS)[number];

export const TEMPERATURES = ["iced", "hot"] as const;
export type Temperature = (typeof TEMPERATURES)[number];

export const NEWS_CATEGORIES = ["japan", "product", "store", "overseas", "media"] as const;
export type NewsCategory = (typeof NEWS_CATEGORIES)[number];

export const VERIFICATION = ["official", "reported", "unverified"] as const;
export type Verification = (typeof VERIFICATION)[number];

export const COLUMN_CATEGORIES = ["report", "menu", "travel", "compare"] as const;
export type ColumnCategory = (typeof COLUMN_CATEGORIES)[number];

export interface RegionNote {
  country: Country;
  note: string;
}

export interface Link {
  title: string;
  url: string;
}

export interface Source {
  name: string;
  url?: string;
}

export interface Menu {
  id: string;
  slug: string;
  nameJa: string;
  nameZh: string;
  /** null when no official English name was found. */
  nameEn: string | null;
  shortDescription: string;
  description: string;
  imageKey: string | null;
  category: MenuCategory;
  teaBase: TeaBase;
  teaDetail: string;
  milkType: MilkType;
  /** Editorial, from tasting; null for menus known only from the official site. */
  sweetness: Sweetness | null;
  /** 1 (rich) .. 5 (refreshing); null when not tasted. */
  lightness: number | null;
  /** 1 .. 5, editorial; null when not tasted. */
  popularity: number | null;
  temperatures: Temperature[];
  aromaTags: string[];
  flavorTags: string[];
  beginnerFriendly: boolean;
  availability: RegionNote[];
  priceNotes: RegionNote[];
  recommendedFor: string[];
  notRecommendedFor: string[];
  tasted: boolean;
  editorRating: number | null;
  editorComment: string | null;
  blogLinks: Link[];
  sources: Source[];
  checkedAt: string | null;
  updatedAt: string;
}

export interface Store {
  id: string;
  slug: string;
  name: string;
  nameLocal: string | null;
  country: Country;
  city: string;
  area: string;
  address: string | null;
  openingHours: string | null;
  access: string | null;
  mapUrl: string | null;
  mapLabel: string | null;
  features: string[];
  cautions: string[];
  goodFor: string[];
  ordering: string | null;
  editorComment: string | null;
  visited: boolean;
  visitedOn: string | null;
  editorPick: boolean;
  imageKeys: string[];
  blogLinks: Link[];
  checkedAt: string | null;
  updatedAt: string;
}

export interface News {
  id: string;
  slug: string;
  title: string;
  summary: string;
  body: string;
  category: NewsCategory;
  verificationStatus: Verification;
  sources: Source[];
  coverKey: string | null;
  publishedAt: string;
  updatedAt: string;
}

export interface ColumnLink {
  id: string;
  title: string;
  excerpt: string;
  url: string;
  category: ColumnCategory;
  country: Country | null;
  sortOrder: number;
  publishedAt: string;
  updatedAt: string;
}
