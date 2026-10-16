import { SITE } from "./site";

export interface Crumb {
  name: string;
  href: string;
}

export interface PageMeta {
  title: string;
  description: string;
  path: string;
  /** Absolute or site-relative image; defaults to the site OGP image. */
  image?: string;
  type?: "website" | "article";
  noindex?: boolean;
  publishedAt?: string;
  updatedAt?: string;
}

export function absoluteUrl(path: string, base: string = SITE.url): string {
  return new URL(path, base).href;
}

/** "メニュー図鑑" → "メニュー図鑑｜CHAGEE日本語ガイド（非公式）". The home page uses the bare name. */
export function pageTitle(title: string): string {
  const site = `${SITE.name}（非公式）`;
  return title === "" || title === SITE.name ? `${site}｜${SITE.nameEn}` : `${title}｜${site}`;
}

/** Search engines cut descriptions around 120 Japanese characters. */
export function clampDescription(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

type JsonLd = Record<string, unknown>;

export function organizationLd(): JsonLd {
  return {
    "@type": "Organization",
    "@id": `${SITE.url}/#publisher`,
    name: SITE.publisher,
    url: SITE.blogUrl,
  };
}

export function websiteLd(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE.url}/#website`,
    name: SITE.name,
    alternateName: SITE.nameEn,
    url: SITE.url,
    inLanguage: "ja",
    description: SITE.description,
    publisher: organizationLd(),
    potentialAction: {
      "@type": "SearchAction",
      target: `${SITE.url}/search?q={query}`,
      "query-input": "required name=query",
    },
  };
}

export function breadcrumbLd(crumbs: Crumb[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: absoluteUrl(crumb.href),
    })),
  };
}

export function articleLd(input: {
  title: string;
  description: string;
  path: string;
  publishedAt: string;
  updatedAt: string;
}): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: input.title,
    description: input.description,
    url: absoluteUrl(input.path),
    mainEntityOfPage: absoluteUrl(input.path),
    datePublished: input.publishedAt,
    dateModified: input.updatedAt,
    inLanguage: "ja",
    author: { "@type": "Person", name: SITE.author, url: SITE.blogUrl },
    publisher: organizationLd(),
  };
}

/** Escapes `<` so a value can never close the surrounding script element. */
export function serializeLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
