import { describe, expect, it } from "vitest";
import { RouteTable, findMissingLegacyRoutes, validateRoutes } from "../rules/routing.js";
import { normalizeRoutePath, parseRoutePath, toAbsoluteUrl } from "../primitives/route-path.js";
import type { RoutePath } from "../primitives/route-path.js";
import { makeRoute } from "./fixtures.js";

const path = (value: string) => value as RoutePath;

describe("normalizeRoutePath", () => {
  it.each([
    ["", "/"],
    ["/", "/"],
    ["posts/x", "/posts/x"],
    ["/posts/x/", "/posts/x"],
    ["//posts///x//", "/posts/x"],
    ["/posts/x?search=1", "/posts/x"],
    ["/posts/x#section", "/posts/x"],
    ["https://tomokichidiary.com/posts/x/", "/posts/x"],
  ])("normalises %s to %s", (input, expected) => {
    expect(normalizeRoutePath(input)).toBe(expected);
  });

  it("rejects paths with characters that cannot appear in a route", () => {
    expect(parseRoutePath("/posts/ゆ").ok).toBe(false);
    expect(parseRoutePath("/posts/ok-1").ok).toBe(true);
  });
});

describe("toAbsoluteUrl", () => {
  it("builds canonical URLs with the configured trailing-slash policy", () => {
    expect(toAbsoluteUrl("https://x.com/", path("/posts/a"), false)).toBe("https://x.com/posts/a");
    expect(toAbsoluteUrl("https://x.com", path("/posts/a"), true)).toBe("https://x.com/posts/a/");
    expect(toAbsoluteUrl("https://x.com", path("/"), false)).toBe("https://x.com/");
  });
});

describe("RouteTable.resolve", () => {
  const routes = [
    makeRoute({ id: "r1" as never, path: path("/posts/chagee-menu-explained") }),
    makeRoute({
      id: "r2" as never,
      path: path("/old-chagee"),
      targetType: "redirect",
      targetId: null,
      isCanonical: false,
      redirectTo: path("/posts/chagee-menu-explained"),
      redirectStatus: 301,
    }),
    makeRoute({
      id: "r3" as never,
      path: path("/older-chagee"),
      targetType: "redirect",
      targetId: null,
      isCanonical: false,
      redirectTo: path("/old-chagee"),
      redirectStatus: 301,
    }),
  ];
  const table = new RouteTable(routes);

  it("resolves a content route to itself", () => {
    const result = table.resolve("/posts/chagee-menu-explained/");
    expect(result.ok && result.value.kind).toBe("target");
  });

  it("follows a redirect chain to the final destination", () => {
    const result = table.resolve("/older-chagee");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe("redirect");
    expect(result.value.destination).toBe("/posts/chagee-menu-explained");
    expect(result.value.status).toBe(301);
  });

  it("reports an unknown path rather than guessing", () => {
    const result = table.resolve("/nope");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]?.code).toBe("ROUTE_NOT_FOUND");
  });

  it("detects a redirect loop", () => {
    const loop = new RouteTable([
      makeRoute({
        path: path("/a"),
        targetType: "redirect",
        targetId: null,
        redirectTo: path("/b"),
      }),
      makeRoute({
        path: path("/b"),
        targetType: "redirect",
        targetId: null,
        redirectTo: path("/a"),
      }),
    ]);
    const result = loop.resolve("/a");
    expect(!result.ok && result.errors[0]?.code).toBe("ROUTE_REDIRECT_LOOP");
  });

  it("finds the canonical route for a target", () => {
    expect(table.canonicalFor("article", "article-1")?.path).toBe("/posts/chagee-menu-explained");
  });

  it("excludes redirects from renderable routes", () => {
    expect(table.renderable()).toHaveLength(1);
  });
});

describe("validateRoutes", () => {
  it("passes a well-formed table", () => {
    expect(validateRoutes([makeRoute()])).toEqual([]);
  });

  it("rejects duplicate paths", () => {
    const errors = validateRoutes([
      makeRoute(),
      makeRoute({ id: "r2" as never, isCanonical: false }),
    ]);
    expect(errors.map((e) => e.code)).toContain("ROUTE_DUPLICATE_PATH");
  });

  it("rejects two canonical routes for the same target", () => {
    const errors = validateRoutes([
      makeRoute(),
      makeRoute({ id: "r2" as never, path: path("/posts/alt") }),
    ]);
    expect(errors.map((e) => e.code)).toContain("SEO_CANONICAL_MISMATCH");
  });

  it("rejects a redirect without a destination and a target without an id", () => {
    const errors = validateRoutes([
      makeRoute({ path: path("/a"), targetType: "redirect", targetId: null, isCanonical: false }),
      makeRoute({ path: path("/b"), targetId: null, isCanonical: false }),
    ]);
    expect(errors.filter((e) => e.code === "ROUTE_TARGET_MISSING")).toHaveLength(2);
  });
});

describe("findMissingLegacyRoutes", () => {
  it("reports legacy URLs the new table cannot answer", () => {
    const routes = [makeRoute({ path: path("/posts/kept") })];
    expect(findMissingLegacyRoutes(["/posts/kept/", "/posts/lost"], routes)).toEqual([
      "/posts/lost",
    ]);
  });
});
