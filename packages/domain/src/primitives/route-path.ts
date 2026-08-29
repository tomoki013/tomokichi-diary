import type { Brand } from "./brand.js";
import { err, ok, type Result } from "./result.js";

/** A site-absolute path, always leading-slash, never trailing-slash except for the root. */
export type RoutePath = Brand<string, "RoutePath">;

export function normalizeRoutePath(value: string): string {
  let path = value.trim();
  if (path === "") return "/";
  // Tolerate absolute URLs so legacy baselines can be imported verbatim.
  if (/^https?:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      /* fall through to the textual normalisation below */
    }
  }
  if (!path.startsWith("/")) path = `/${path}`;
  path = path.replace(/\/{2,}/g, "/");
  const [withoutQuery] = path.split(/[?#]/);
  path = withoutQuery ?? "/";
  if (path.length > 1) path = path.replace(/\/+$/, "");
  return path === "" ? "/" : path;
}

export function parseRoutePath(value: string): Result<RoutePath> {
  const normalized = normalizeRoutePath(value);
  if (!/^\/[\w\-./~%]*$/.test(normalized)) {
    return err({
      code: "API_VALIDATION_FAILED",
      message: `invalid route path: ${value}`,
      field: "path",
    });
  }
  return ok(normalized as RoutePath);
}

export function joinRoutePath(...segments: string[]): RoutePath {
  return normalizeRoutePath(segments.join("/")) as RoutePath;
}

/** Absolute URL for a path, used for canonical tags, sitemaps and feeds. */
export function toAbsoluteUrl(siteUrl: string, path: RoutePath, trailingSlash: boolean): string {
  const base = siteUrl.replace(/\/+$/, "");
  if (path === "/") return `${base}/`;
  return `${base}${path}${trailingSlash ? "/" : ""}`;
}
