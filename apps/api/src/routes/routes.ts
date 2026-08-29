import { Hono } from "hono";
import { validate } from "@tomokichi/contracts";
import { checkRouteIntegrity, moveRoute, resolveRoute } from "@tomokichi/application";
import type { RedirectStatus } from "@tomokichi/domain";
import type { AppEnv } from "../app.js";
import { domainErrorResponse, errorResponse } from "../http.js";
import { toRouteDto } from "../mappers.js";
import { moveRouteSchema } from "../schemas.js";

export function routeRoutes() {
  const routes = new Hono<AppEnv>();

  routes.get("/", async (c) => {
    const all = await c.get("ctx").repos.routes.listAll();
    return c.json({ items: all.map(toRouteDto) });
  });

  routes.get("/resolve", async (c) => {
    const path = c.req.query("path");
    if (!path)
      return errorResponse(c, "API_VALIDATION_FAILED", "a `path` query parameter is required", 400);

    const result = await resolveRoute(c.get("ctx"), path);
    if (!result.ok) return domainErrorResponse(c, result.errors);
    return c.json({
      kind: result.value.kind,
      destination: result.value.destination,
      status: result.value.status,
      route: toRouteDto(result.value.route),
    });
  });

  routes.get("/integrity", async (c) => {
    const problems = await checkRouteIntegrity(c.get("ctx"));
    return c.json({
      ok: problems.length === 0,
      problems: problems.map((problem) => ({
        code: problem.code,
        target: problem.field ?? null,
        message: problem.message,
      })),
    });
  });

  routes.post("/move", async (c) => {
    const parsed = validate(moveRouteSchema, await c.req.json().catch(() => null));
    if (!parsed.ok)
      return errorResponse(c, parsed.code, "invalid request body", 400, parsed.issues);

    const result = await moveRoute(
      c.get("ctx"),
      parsed.value.from,
      parsed.value.to,
      Number(parsed.value.status) as RedirectStatus,
    );
    if (!result.ok) return domainErrorResponse(c, result.errors);
    return c.json({
      canonical: toRouteDto(result.value.canonical),
      redirect: toRouteDto(result.value.redirect),
    });
  });

  return routes;
}
