import type { Route } from "../entities/route.js";
import { normalizeRoutePath, type RoutePath } from "../primitives/route-path.js";
import { err, ok, type DomainError, type Result } from "../primitives/result.js";

export interface RouteResolution {
  readonly kind: "target" | "redirect";
  readonly route: Route;
  /** Final destination after following the redirect chain. */
  readonly destination: RoutePath | null;
  readonly status: number;
}

const MAX_REDIRECT_HOPS = 5;

export class RouteTable {
  private readonly byPath: Map<string, Route>;

  constructor(routes: readonly Route[]) {
    this.byPath = new Map(routes.map((route) => [route.path, route]));
  }

  get size(): number {
    return this.byPath.size;
  }

  find(path: string): Route | undefined {
    return this.byPath.get(normalizeRoutePath(path));
  }

  /** Follows redirects to the page that will actually be served. */
  resolve(path: string): Result<RouteResolution> {
    let current = this.find(path);
    if (!current) {
      return err({ code: "ROUTE_NOT_FOUND", message: `no route for ${path}` });
    }

    const seen = new Set<string>([current.path]);
    for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop++) {
      if (current.targetType !== "redirect" || current.redirectTo === null) {
        return ok({ kind: "target", route: current, destination: current.path, status: 200 });
      }
      const next = this.find(current.redirectTo);
      if (!next) {
        return ok({
          kind: "redirect",
          route: current,
          destination: current.redirectTo,
          status: current.redirectStatus ?? 301,
        });
      }
      if (seen.has(next.path)) {
        return err({ code: "ROUTE_REDIRECT_LOOP", message: `redirect loop at ${next.path}` });
      }
      seen.add(next.path);
      if (next.targetType !== "redirect") {
        return ok({
          kind: "redirect",
          route: current,
          destination: next.path,
          status: current.redirectStatus ?? 301,
        });
      }
      current = next;
    }
    return err({
      code: "ROUTE_REDIRECT_LOOP",
      message: `redirect chain longer than ${MAX_REDIRECT_HOPS} hops`,
    });
  }

  canonicalFor(targetType: Route["targetType"], targetId: string): Route | undefined {
    for (const route of this.byPath.values()) {
      if (route.isCanonical && route.targetType === targetType && route.targetId === targetId)
        return route;
    }
    return undefined;
  }

  /** Routes rendered as static pages: everything that is not a redirect. */
  renderable(): Route[] {
    return [...this.byPath.values()].filter((r) => r.targetType !== "redirect");
  }
}

/** Structural problems that must never reach production. */
export function validateRoutes(routes: readonly Route[]): readonly DomainError[] {
  const errors: DomainError[] = [];
  const seenPaths = new Set<string>();
  const canonicalByTarget = new Map<string, number>();

  for (const route of routes) {
    if (route.path !== normalizeRoutePath(route.path)) {
      errors.push({
        code: "ROUTE_DUPLICATE_PATH",
        message: `path is not normalised: ${route.path}`,
        field: route.path,
      });
    }
    if (seenPaths.has(route.path)) {
      errors.push({
        code: "ROUTE_DUPLICATE_PATH",
        message: `duplicate path: ${route.path}`,
        field: route.path,
      });
    }
    seenPaths.add(route.path);

    if (route.targetType === "redirect") {
      if (!route.redirectTo) {
        errors.push({
          code: "ROUTE_TARGET_MISSING",
          message: `redirect without destination: ${route.path}`,
          field: route.path,
        });
      }
    } else if (route.targetId === null) {
      errors.push({
        code: "ROUTE_TARGET_MISSING",
        message: `route without target: ${route.path}`,
        field: route.path,
      });
    }

    if (route.isCanonical && route.targetId !== null && route.targetType !== "redirect") {
      const key = `${route.targetType}:${route.targetId}:${route.locale}`;
      canonicalByTarget.set(key, (canonicalByTarget.get(key) ?? 0) + 1);
    }
  }

  for (const [key, count] of canonicalByTarget) {
    if (count > 1) {
      errors.push({
        code: "SEO_CANONICAL_MISMATCH",
        message: `${count} canonical routes for ${key}`,
        field: key,
      });
    }
  }

  const table = new RouteTable(routes);
  for (const route of routes) {
    if (route.targetType !== "redirect") continue;
    const resolved = table.resolve(route.path);
    if (!resolved.ok) errors.push(...resolved.errors);
  }

  return errors;
}

/** Legacy URLs that the rewrite must keep answering (instruction §30). */
export function findMissingLegacyRoutes(
  legacyPaths: readonly string[],
  routes: readonly Route[],
): readonly string[] {
  const table = new RouteTable(routes);
  return legacyPaths.map(normalizeRoutePath).filter((path) => !table.resolve(path).ok);
}
