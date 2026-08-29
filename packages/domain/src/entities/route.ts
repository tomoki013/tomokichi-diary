import type { RouteId } from "../primitives/id.js";
import type { Locale } from "../primitives/locale.js";
import type { RoutePath } from "../primitives/route-path.js";

export const ROUTE_TARGET_TYPES = [
  "article",
  "location",
  "place",
  "category",
  "tag",
  "series",
  "journey",
  "static",
  "redirect",
] as const;
export type RouteTargetType = (typeof ROUTE_TARGET_TYPES)[number];

export const REDIRECT_STATUSES = [301, 302, 308] as const;
export type RedirectStatus = (typeof REDIRECT_STATUSES)[number];

/**
 * URLs are their own data. They outlive slugs, article ids and this
 * implementation (ADR 0002), so nothing derives a URL from a slug at runtime.
 */
export interface Route {
  readonly id: RouteId;
  readonly path: RoutePath;
  readonly locale: Locale;
  readonly targetType: RouteTargetType;
  /** Entity id for content targets; the page key for `static`; null for `redirect`. */
  readonly targetId: string | null;
  /** Exactly one canonical route per target. Others are alternates. */
  readonly isCanonical: boolean;
  readonly redirectTo: RoutePath | null;
  readonly redirectStatus: RedirectStatus | null;
  /** Present in the legacy baseline; must keep resolving after the rewrite. */
  readonly isLegacy: boolean;
}
