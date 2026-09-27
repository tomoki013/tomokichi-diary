/**
 * Hash routing. The admin is static files behind a single-page fallback, and a
 * hash keeps every screen addressable without a router dependency or server
 * rewrites.
 */
export type Route =
  | { name: "dashboard" }
  | { name: "articles" }
  | { name: "article"; id: string }
  | { name: "media" }
  | { name: "routes" }
  | { name: "inquiries" }
  | { name: "inquiry"; id: string }
  | { name: "legacy-messages" }
  | { name: "not-found"; path: string };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, "").replace(/\/+$/, "") || "/";
  const [first, second, ...rest] = path.split("/").filter(Boolean);
  if (rest.length > 0) return { name: "not-found", path };

  switch (first) {
    case undefined:
      return { name: "dashboard" };
    case "articles":
      return second ? { name: "article", id: decodeURIComponent(second) } : { name: "articles" };
    case "media":
      return second ? { name: "not-found", path } : { name: "media" };
    case "routes":
      return second ? { name: "not-found", path } : { name: "routes" };
    case "inquiries":
      if (!second) return { name: "inquiries" };
      if (second === "archive") return { name: "legacy-messages" };
      return { name: "inquiry", id: decodeURIComponent(second) };
    default:
      return { name: "not-found", path };
  }
}

export const href = {
  dashboard: () => "#/",
  articles: () => "#/articles",
  article: (id: string) => `#/articles/${encodeURIComponent(id)}`,
  media: () => "#/media",
  routes: () => "#/routes",
  inquiries: () => "#/inquiries",
  inquiry: (id: string) => `#/inquiries/${encodeURIComponent(id)}`,
  legacyMessages: () => "#/inquiries/archive",
};

/** Which navigation entry a route belongs under. */
export function section(
  route: Route,
): "dashboard" | "articles" | "media" | "routes" | "inquiries" | null {
  switch (route.name) {
    case "dashboard":
      return "dashboard";
    case "articles":
    case "article":
      return "articles";
    case "media":
      return "media";
    case "routes":
      return "routes";
    case "inquiries":
    case "inquiry":
    case "legacy-messages":
      return "inquiries";
    default:
      return null;
  }
}
