import { useEffect, useState } from "react";

/**
 * Hash routing: the admin is static files behind a single-page fallback, and
 * a hash keeps every screen addressable without a router dependency.
 */
export type Route =
  | { name: "home" }
  | { name: "articles"; filter: string | null }
  | { name: "article"; id: string }
  | { name: "new-article"; kind: "article" | "page" }
  | { name: "notes" }
  | { name: "note"; id: string }
  | { name: "media" }
  | { name: "series" }
  | { name: "series-edit"; id: string }
  | { name: "rankings" }
  | { name: "ranking"; id: string }
  | { name: "ads" }
  | { name: "knowledge" }
  | { name: "analytics" }
  | { name: "inquiries" }
  | { name: "inquiry"; id: string }
  | { name: "inquiry-settings" }
  | { name: "site" }
  | { name: "connections" }
  | { name: "activity"; targetType?: string; targetId?: string }
  | { name: "more" }
  | { name: "not-found"; path: string };

export function parseRoute(hash: string): Route {
  const [rawPath = "", query = ""] = hash.replace(/^#/, "").split("?");
  const path = rawPath.replace(/\/+$/, "") || "/";
  const params = new URLSearchParams(query);
  const [first, second, third, ...rest] = path.split("/").filter(Boolean).map(decodeURIComponent);
  const one = (route: Route): Route => (second ? { name: "not-found", path } : route);
  if (rest.length > 0 || (third && first !== "activity")) return { name: "not-found", path };
  switch (first) {
    case undefined:
      return { name: "home" };
    case "articles":
      if (second === "new")
        return { name: "new-article", kind: params.get("kind") === "page" ? "page" : "article" };
      return second
        ? { name: "article", id: second }
        : { name: "articles", filter: params.get("filter") };
    case "notes":
      return second ? { name: "note", id: second } : { name: "notes" };
    case "series":
      return second ? { name: "series-edit", id: second } : { name: "series" };
    case "rankings":
      return second ? { name: "ranking", id: second } : { name: "rankings" };
    case "inquiries":
      if (second === "settings") return { name: "inquiry-settings" };
      return second ? { name: "inquiry", id: second } : { name: "inquiries" };
    case "activity":
      return second && third
        ? { name: "activity", targetType: second, targetId: third }
        : one({ name: "activity" });
    case "media":
    case "ads":
    case "knowledge":
    case "analytics":
    case "site":
    case "connections":
    case "more":
      return one({ name: first } as Route);
    default:
      return { name: "not-found", path };
  }
}

const enc = encodeURIComponent;
export const href = {
  home: () => "#/",
  articles: (filter?: string) => (filter ? `#/articles?filter=${enc(filter)}` : "#/articles"),
  article: (id: string) => `#/articles/${enc(id)}`,
  newArticle: (kind: "article" | "page" = "article") =>
    kind === "page" ? "#/articles/new?kind=page" : "#/articles/new",
  notes: () => "#/notes",
  note: (id: string) => `#/notes/${enc(id)}`,
  media: () => "#/media",
  series: () => "#/series",
  seriesEdit: (id: string) => `#/series/${enc(id)}`,
  rankings: () => "#/rankings",
  ranking: (id: string) => `#/rankings/${enc(id)}`,
  ads: () => "#/ads",
  knowledge: () => "#/knowledge",
  analytics: () => "#/analytics",
  inquiries: () => "#/inquiries",
  inquiry: (id: string) => `#/inquiries/${enc(id)}`,
  inquirySettings: () => "#/inquiries/settings",
  site: () => "#/site",
  connections: () => "#/connections",
  activity: (targetType?: string, targetId?: string) =>
    targetType && targetId ? `#/activity/${enc(targetType)}/${enc(targetId)}` : "#/activity",
  more: () => "#/more",
};

/** The five places on the phone's bottom bar; everything else is under "その他". */
export type Section = "home" | "articles" | "notes" | "media" | "more";
export function sectionOf(route: Route): Section {
  switch (route.name) {
    case "home":
      return "home";
    case "articles":
    case "article":
    case "new-article":
      return "articles";
    case "notes":
    case "note":
      return "notes";
    case "media":
      return "media";
    default:
      return "more";
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(globalThis.location.hash));
  useEffect(() => {
    const update = () => {
      setRoute(parseRoute(globalThis.location.hash));
      globalThis.scrollTo?.(0, 0);
    };
    globalThis.addEventListener("hashchange", update);
    return () => globalThis.removeEventListener("hashchange", update);
  }, []);
  return route;
}

export function go(target: string): void {
  globalThis.location.hash = target.replace(/^#/, "");
}
