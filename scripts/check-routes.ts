import { RouteTable, normalizeRoutePath, validateRoutes } from "@tomokichi/domain";
import type { Finding } from "./lib/report.js";
import { listBuiltPages, loadLegacyBaseline, loadSnapshot, report } from "./lib/built-site.js";

/**
 * The rewrite is only safe if every URL the old site served still answers, and
 * if every route in the table actually produced a page (instruction §37).
 */
const snapshot = loadSnapshot();
const table = new RouteTable(snapshot.routes);
const built = new Set(listBuiltPages().map((page) => page.path));
const findings: Finding[] = [];

for (const error of validateRoutes(snapshot.routes)) {
  findings.push({
    code: error.code,
    target: error.field,
    message: error.message,
    rerun: "pnpm check:routes",
  });
}

const legacy = loadLegacyBaseline<{ path: string }>("legacy-routes.json").map((entry) =>
  normalizeRoutePath(entry.path),
);
for (const path of legacy) {
  const resolved = table.resolve(path);
  if (!resolved.ok) {
    findings.push({
      code: "ROUTE_LEGACY_MISSING",
      target: path,
      message: "a URL the previous site published no longer resolves",
      rerun: "pnpm check:routes",
    });
    continue;
  }
  const destination = resolved.value.destination;
  if (destination !== null && !built.has(destination)) {
    findings.push({
      code: "ROUTE_LEGACY_MISSING",
      target: path,
      message: `resolves to ${destination}, which was not generated`,
      rerun: "pnpm check:routes",
    });
  }
}

for (const route of table.renderable()) {
  if (!built.has(route.path)) {
    findings.push({
      code: "ROUTE_TARGET_MISSING",
      target: route.path,
      message: "route exists but no page was generated",
      rerun: "pnpm build",
    });
  }
}

report(
  findings,
  {
    routes: `${legacy.length - findings.filter((f) => f.code === "ROUTE_LEGACY_MISSING").length}/${legacy.length}`,
  },
  "routes",
);
