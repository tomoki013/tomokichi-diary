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
import { messageRoutes } from "./routes/messages.js";

/** Verifies a Turnstile token. Injected so the HTTP layer stays testable. */
export type ChallengeVerifier = (
  secret: string,
  token: string,
  ip: string | undefined,
) => Promise<boolean>;

export type AppEnv = {
  Bindings: Env;
  Variables: { requestId: string; ctx: AppContext; verifyChallenge: ChallengeVerifier };
};

export interface AppOptions {
  /** Overridden by tests so the HTTP layer can run against in-memory adapters. */
  contextFactory?: (env: Env, requestId: string) => AppContext;
  verifyChallenge?: ChallengeVerifier;
}

/**
 * HTTP adapter only: routing, authentication, validation and response shaping.
 * Every decision about content lives in @tomokichi/application (instruction §7).
 */
export function createApp(options: AppOptions = {}) {
  const buildContext = options.contextFactory ?? createContext;
  const verifyChallenge = options.verifyChallenge ?? verifyTurnstile;
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    const requestId = c.req.header("x-request-id") ?? generateId();
    c.set("requestId", requestId);
    c.set("ctx", buildContext(c.env, requestId));
    c.set("verifyChallenge", verifyChallenge);
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

  app.get("/health", (c) => c.json({ status: "ok", requestId: c.get("requestId") }));

  // The only unauthenticated write: a challenge-protected contact form.
  app.route("/contact", contactRoutes());

  // Everything below /admin requires the shared secret. A missing secret means
  // the admin API is closed, never open.
  app.use("/admin/*", async (c, next) => {
    const expected = c.env.ADMIN_TOKEN;
    const provided = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
    if (!expected || !provided || provided !== expected) {
      c.get("ctx").logger.warn("admin.unauthorized", {
        code: "API_UNAUTHORIZED",
        route: c.req.path,
      });
      return errorResponse(c, "API_UNAUTHORIZED", "a valid admin token is required", 401);
    }
    await next();
  });

  app.route("/admin/articles", articleRoutes());
  app.route("/admin/media", mediaRoutes());
  app.route("/admin/routes", routeRoutes());
  app.route("/admin/messages", messageRoutes());
  app.route("/admin", referenceRoutes());

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
