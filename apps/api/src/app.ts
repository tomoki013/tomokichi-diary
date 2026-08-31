import { Hono } from "hono";
import type { AppContext } from "@tomokichi/application";
import { generateId } from "@tomokichi/domain";
import type { Env } from "./env.js";
import { errorResponse } from "./http.js";
import { createContext } from "./context.js";
import { articleRoutes } from "./routes/articles.js";
import { mediaRoutes } from "./routes/media.js";
import { referenceRoutes } from "./routes/reference.js";
import { routeRoutes } from "./routes/routes.js";
import { contactRoutes, verifyTurnstile } from "./routes/contact.js";
import { verifyAccessJwt, type AccessIdentity } from "./access.js";
import { messageRoutes } from "./routes/messages.js";
import { likeRoutes } from "./routes/likes.js";

/** Verifies a Turnstile token. Injected so the HTTP layer stays testable. */
export type ChallengeVerifier = (
  secret: string,
  token: string,
  ip: string | undefined,
  expectedHostname?: string,
) => Promise<boolean>;

/** Verifies a Cloudflare Access identity token. Injected so tests can stand in for it. */
export type AccessVerifier = (
  token: string,
  teamDomain: string,
  audience: string,
) => Promise<AccessIdentity | null>;

export type AppEnv = {
  Bindings: Env;
  Variables: {
    requestId: string;
    ctx: AppContext;
    verifyChallenge: ChallengeVerifier;
    verifyAccess: AccessVerifier;
  };
};

export interface AppOptions {
  /** Overridden by tests so the HTTP layer can run against in-memory adapters. */
  contextFactory?: (env: Env, requestId: string) => AppContext;
  verifyChallenge?: ChallengeVerifier;
  verifyAccess?: AccessVerifier;
}

/**
 * HTTP adapter only: routing, authentication, validation and response shaping.
 * Every decision about content lives in @tomokichi/application (instruction §7).
 */
/**
 * Compares a shared secret without leaking its length or contents through
 * timing. Both sides are trimmed first: a secret set from a pipe can pick up a
 * trailing newline, and silently rejecting every request afterwards is a
 * miserable thing to debug.
 */
function secretsMatch(expected: string, provided: string): boolean {
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(provided);
  // Compare a fixed number of bytes so the loop count never depends on input.
  const length = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;
  for (let index = 0; index < length; index++) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

export function createApp(options: AppOptions = {}) {
  const buildContext = options.contextFactory ?? createContext;
  const verifyChallenge = options.verifyChallenge ?? verifyTurnstile;
  const verifyAccess = options.verifyAccess ?? verifyAccessJwt;
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    const requestId = c.req.header("x-request-id") ?? generateId();
    c.set("requestId", requestId);
    c.set("ctx", buildContext(c.env, requestId));
    c.set("verifyChallenge", verifyChallenge);
    c.set("verifyAccess", verifyAccess);
    await next();
    c.header("x-request-id", requestId);
  });

  app.use("*", async (c, next) => {
    const allowed = (c.env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);
    const origin = c.req.header("origin");
    if (origin && allowed.includes(origin)) {
      c.header("access-control-allow-origin", origin);
      c.header("access-control-allow-headers", "authorization, content-type, x-request-id");
      c.header("access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS");
      c.header("vary", "origin");
    }
    if (c.req.method === "OPTIONS") return c.body(null, 204);
    await next();
  });

  // `/health` is deliberately unversioned: it answers "is this Worker up",
  // which is not a contract that can change shape.
  app.get("/health", (c) => c.json({ status: "ok", requestId: c.get("requestId") }));

  /*
   * Everything else is versioned. The public site bakes the contact endpoint
   * into static HTML that lives in caches and bookmarks, and the admin is
   * deployed separately from the API — so a client can outlive the server it
   * was built against, which is exactly what a version prefix is for.
   */
  const v1 = new Hono<AppEnv>();

  v1.use("*", async (c, next) => {
    await next();
    c.header("api-version", "1");
  });

  // The only unauthenticated write: a challenge-protected contact form.
  v1.route("/contact", contactRoutes());
  v1.route("/likes", likeRoutes());

  // Everything below /admin requires the shared secret. A missing secret means
  // the admin API is closed, never open.
  /*
   * Admin access is granted by Cloudflare Access once it is configured, and by
   * the shared bearer token otherwise. Configuring Access does not silently
   * disable the token — remove `ADMIN_TOKEN` to make Access the only way in.
   */
  v1.use("/admin/*", async (c, next) => {
    const teamDomain = c.env.ACCESS_TEAM_DOMAIN?.trim();
    const audience = c.env.ACCESS_AUD?.trim();
    const assertion = c.req.header("cf-access-jwt-assertion");

    if (teamDomain && audience && assertion) {
      const identity = await c.get("verifyAccess")(assertion, teamDomain, audience);
      if (identity) {
        c.get("ctx").logger.info("admin.authenticated", { via: "access", email: identity.email });
        await next();
        return;
      }
      c.get("ctx").logger.warn("admin.access_rejected", {
        code: "API_UNAUTHORIZED",
        route: c.req.path,
      });
    }

    const expected = c.env.ADMIN_TOKEN?.trim();
    const provided = c.req
      .header("authorization")
      ?.replace(/^Bearer\s+/i, "")
      .trim();
    if (!expected || !provided || !secretsMatch(expected, provided)) {
      c.get("ctx").logger.warn("admin.unauthorized", {
        code: "API_UNAUTHORIZED",
        route: c.req.path,
      });
      return errorResponse(c, "API_UNAUTHORIZED", "a valid admin token is required", 401);
    }
    await next();
  });

  v1.route("/admin/articles", articleRoutes());
  v1.route("/admin/media", mediaRoutes());
  v1.route("/admin/routes", routeRoutes());
  v1.route("/admin/messages", messageRoutes());
  v1.route("/admin", referenceRoutes());

  app.route("/v1", v1);

  app.notFound((c) => errorResponse(c, "API_NOT_FOUND", `no route for ${c.req.path}`, 404));

  app.onError((error, c) => {
    c.get("ctx").logger.error("request.failed", {
      code: "API_INTERNAL",
      route: c.req.path,
      message: error.message,
    });
    return errorResponse(c, "API_INTERNAL", "internal error", 500);
  });

  return app;
}
