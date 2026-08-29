import {
  toAbsoluteUrl,
  type Article,
  type ArticleRevision,
  type Location,
  type Place,
  type Route,
} from "@tomokichi/domain";
import type { SeoConfig } from "./config.js";

/**
 * JSON-LD is derived, never stored: the entities are the source of truth, so a
 * schema.org change is a code change and not a migration (ADR 0004, §33).
 */
export type JsonLd = Record<string, unknown>;

function publisher(config: SeoConfig): JsonLd {
  return {
    "@type": "Organization",
    name: config.publisherName,
    logo: { "@type": "ImageObject", url: config.publisherLogoUrl },
  };
}

export interface ArticleJsonLdInput {
  readonly article: Article;
  readonly revision: ArticleRevision;
  readonly route: Route;
  readonly description: string;
  readonly coverImageUrl: string | null;
  readonly author: { readonly name: string; readonly url: string | null } | null;
  readonly about: readonly (Location | Place)[];
}

export function buildArticleJsonLd(config: SeoConfig, input: ArticleJsonLdInput): JsonLd {
  const url = toAbsoluteUrl(config.siteUrl, input.route.path, config.trailingSlash);
  const jsonLd: JsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    headline: input.revision.title,
    description: input.description,
    url,
    inLanguage: input.article.locale,
    datePublished: input.article.publishedAt,
    dateModified: input.article.updatedAt,
    publisher: publisher(config),
  };
  if (input.coverImageUrl) jsonLd["image"] = [input.coverImageUrl];
  if (input.author) {
    jsonLd["author"] = {
      "@type": "Person",
      name: input.author.name,
      ...(input.author.url ? { url: input.author.url } : {}),
    };
  }
  if (input.about.length > 0) {
    jsonLd["about"] = input.about.map((entity) =>
      "kind" in entity ? placeNode(entity) : { "@type": "Place", name: entity.slug },
    );
  }
  return jsonLd;
}

function placeNode(place: Place): JsonLd {
  const node: JsonLd = { "@type": schemaTypeForPlace(place.kind), name: place.name };
  if (place.address) node["address"] = place.address;
  if (place.officialUrl) node["url"] = place.officialUrl;
  if (place.latitude !== null && place.longitude !== null) {
    node["geo"] = {
      "@type": "GeoCoordinates",
      latitude: place.latitude,
      longitude: place.longitude,
    };
  }
  return node;
}

function schemaTypeForPlace(kind: Place["kind"]): string {
  switch (kind) {
    case "restaurant":
      return "Restaurant";
    case "cafe":
      return "CafeOrCoffeeShop";
    case "shop":
      return "Store";
    case "hotel":
      return "Hotel";
    case "airport":
      return "Airport";
    case "station":
      return "TrainStation";
    case "attraction":
      return "TouristAttraction";
    case "landmark":
      return "LandmarksOrHistoricalBuildings";
    case "other":
      return "Place";
  }
}

export function buildPlaceJsonLd(config: SeoConfig, place: Place, route: Route | null): JsonLd {
  const node: JsonLd = { "@context": "https://schema.org", ...placeNode(place) };
  if (route) node["url"] = toAbsoluteUrl(config.siteUrl, route.path, config.trailingSlash);
  return node;
}

export interface Breadcrumb {
  readonly name: string;
  readonly route: Route;
}

export function buildBreadcrumbJsonLd(
  config: SeoConfig,
  trail: readonly Breadcrumb[],
): JsonLd | null {
  if (trail.length < 2) return null;
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: toAbsoluteUrl(config.siteUrl, crumb.route.path, config.trailingSlash),
    })),
  };
}

export function buildWebSiteJsonLd(config: SeoConfig): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: config.siteName,
    url: `${config.siteUrl.replace(/\/+$/, "")}/`,
    publisher: publisher(config),
  };
}

/** Serialised for a `<script type="application/ld+json">` body. */
export function serializeJsonLd(jsonLd: JsonLd | null): string {
  return jsonLd === null ? "" : JSON.stringify(jsonLd).replaceAll("<", "\\u003c");
}
