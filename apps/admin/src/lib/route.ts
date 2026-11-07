/**
 * Hash routing. The admin is static files behind a single-page fallback, and a
 * hash keeps every screen addressable without a router dependency or server
 * rewrites.
 */
export type Route =
  | { name: "dashboard" }
  | { name: "analytics" }
  | { name: "activity"; targetType?: string; targetId?: string }
  | { name: "mcp-connections" }
  | { name: "articles" }
  | { name: "article"; id: string }
  | { name: "diary-notes" }
  | { name: "diary-note"; id: string }
  | { name: "monetization" }
  | { name: "media" }
  | { name: "series" }
  | { name: "series-edit"; id: string }
  | { name: "rankings" }
  | { name: "ranking-edit"; id: string }
  | { name: "legal" }
  | { name: "routes" }
  | { name: "likes" }
  | { name: "inquiries" }
  | { name: "inquiry"; id: string }
  | { name: "inquiry-settings" }
  | { name: "legacy-messages" }
  | { name: "not-found"; path: string };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, "").replace(/\/+$/, "") || "/";
  const [first, second, ...rest] = path.split("/").filter(Boolean);
  if (first === "activity") {
    if (!second && rest.length === 0) return { name: "activity" };
    if (second && rest.length === 1)
      return { name: "activity", targetType: second, targetId: decodeURIComponent(rest[0]!) };
    return { name: "not-found", path };
  }
  if (rest.length > 0) return { name: "not-found", path };

  switch (first) {
    case undefined:
      return { name: "dashboard" };
    case "articles":
      return second ? { name: "article", id: decodeURIComponent(second) } : { name: "articles" };
    case "notes":
      return second
        ? { name: "diary-note", id: decodeURIComponent(second) }
        : { name: "diary-notes" };
    case "analytics":
      return second ? { name: "not-found", path } : { name: "analytics" };
    case "activity":
      return second ? { name: "not-found", path } : { name: "activity" };
    case "mcp-connections":
      return second ? { name: "not-found", path } : { name: "mcp-connections" };
    case "monetization":
      return second ? { name: "not-found", path } : { name: "monetization" };
    case "media":
      return second ? { name: "not-found", path } : { name: "media" };
    case "rankings":
      return second
        ? { name: "ranking-edit", id: decodeURIComponent(second) }
        : { name: "rankings" };
    case "legal":
      return second ? { name: "not-found", path } : { name: "legal" };
    case "routes":
      return second ? { name: "not-found", path } : { name: "routes" };
    case "likes":
      return second ? { name: "not-found", path } : { name: "likes" };
    case "series":
      return second ? { name: "series-edit", id: decodeURIComponent(second) } : { name: "series" };
    case "inquiries":
      if (!second) return { name: "inquiries" };
      if (second === "archive") return { name: "legacy-messages" };
      if (second === "settings") return { name: "inquiry-settings" };
      return { name: "inquiry", id: decodeURIComponent(second) };
    default:
      return { name: "not-found", path };
  }
}

export const href = {
  dashboard: () => "#/",
  analytics: () => "#/analytics",
  activity: (targetId?: string, targetType = "article") =>
    `#/activity${targetId ? `/${encodeURIComponent(targetType)}/${encodeURIComponent(targetId)}` : ""}`,
  mcpConnections: () => "#/mcp-connections",
  articles: () => "#/articles",
  article: (id: string) => `#/articles/${encodeURIComponent(id)}`,
  diaryNotes: () => "#/notes",
  diaryNote: (id: string) => `#/notes/${encodeURIComponent(id)}`,
  monetization: () => "#/monetization",
  media: () => "#/media",
  series: () => "#/series",
  seriesEdit: (id: string) => `#/series/${encodeURIComponent(id)}`,
  rankings: () => "#/rankings",
  rankingEdit: (id: string) => `#/rankings/${encodeURIComponent(id)}`,
  legal: () => "#/legal",
  routes: () => "#/routes",
  likes: () => "#/likes",
  inquiries: () => "#/inquiries",
  inquiry: (id: string) => `#/inquiries/${encodeURIComponent(id)}`,
  legacyMessages: () => "#/inquiries/archive",
  inquirySettings: () => "#/inquiries/settings",
};

/** Which navigation entry a route belongs under. */
export function section(
  route: Route,
):
  | "dashboard"
  | "analytics"
  | "activity"
  | "mcp-connections"
  | "articles"
  | "diary-notes"
  | "monetization"
  | "media"
  | "series"
  | "rankings"
  | "legal"
  | "routes"
  | "likes"
  | "inquiries"
  | null {
  switch (route.name) {
    case "dashboard":
      return "dashboard";
    case "monetization":
      return "monetization";
    case "analytics":
      return "analytics";
    case "activity":
      return "activity";
    case "mcp-connections":
      return "mcp-connections";
    case "articles":
    case "article":
      return "articles";
    case "diary-notes":
    case "diary-note":
      return "diary-notes";
    case "media":
      return "media";
    case "series":
    case "series-edit":
      return "series";
    case "rankings":
    case "ranking-edit":
      return "rankings";
    case "legal":
      return "legal";
    case "routes":
      return "routes";
    case "likes":
      return "likes";
    case "inquiries":
    case "inquiry":
    case "inquiry-settings":
    case "legacy-messages":
      return "inquiries";
    default:
      return null;
  }
}
