import {
  RouteTable,
  err,
  ok,
  parseRoutePath,
  validateRoutes,
  type RedirectStatus,
  type Result,
  type Route,
  type RouteId,
  type RouteResolution,
} from "@tomokichi/domain";
import type { AppContext } from "../../context.js";

export async function resolveRoute(
  ctx: AppContext,
  path: string,
): Promise<Result<RouteResolution>> {
  return new RouteTable(await ctx.repos.routes.listAll()).resolve(path);
}

/**
 * The only supported way to move a URL: the old path stays in the table as an
 * explicit redirect rather than disappearing (instruction §31).
 */
export async function moveRoute(
  ctx: AppContext,
  fromPath: string,
  toPath: string,
  status: RedirectStatus = 301,
): Promise<Result<{ redirect: Route; canonical: Route }>> {
  const from = parseRoutePath(fromPath);
  const to = parseRoutePath(toPath);
  if (!from.ok) return err(...from.errors);
  if (!to.ok) return err(...to.errors);

  const existing = await ctx.repos.routes.findByPath(from.value);
  if (!existing) return err({ code: "ROUTE_NOT_FOUND", message: `no route ${from.value}` });
  if (existing.targetType === "redirect") {
    return err({ code: "API_CONFLICT", message: `${from.value} is already a redirect` });
  }
  if (await ctx.repos.routes.findByPath(to.value)) {
    return err({ code: "API_CONFLICT", message: `path already in use: ${to.value}` });
  }

  const canonical: Route = {
    ...existing,
    id: ctx.ids.next<RouteId>(),
    path: to.value,
    isLegacy: false,
  };
  const redirect: Route = {
    ...existing,
    targetType: "redirect",
    targetId: null,
    isCanonical: false,
    redirectTo: to.value,
    redirectStatus: status,
  };

  await ctx.repos.routes.save(canonical);
  await ctx.repos.routes.save(redirect);
  ctx.logger.info("route.moved", { route: from.value, to: to.value });
  return ok({ redirect, canonical });
}

export async function checkRouteIntegrity(ctx: AppContext, legacyPaths: readonly string[] = []) {
  const routes = await ctx.repos.routes.listAll();
  const table = new RouteTable(routes);
  const errors = [...validateRoutes(routes)];
  for (const path of legacyPaths) {
    if (!table.resolve(path).ok) {
      errors.push({
        code: "ROUTE_LEGACY_MISSING",
        message: `legacy URL no longer resolves: ${path}`,
        field: path,
      });
    }
  }
  return errors;
}
