import { resendWebhook } from "./resend-webhook.js";
import { Hono } from "hono";
import type { AppContext } from "@tomokichi/application";
import type { SqlDatabase } from "@tomokichi/infra-d1";
import { generateId, type MediaId } from "@tomokichi/domain";
import type { Env } from "./env.js";
import { errorResponse } from "./http.js";
import { createContext } from "./context.js";
import { requestPublication } from "./publication.js";
import { imageRoutes } from "./routes/images.js";
import { contactRoutes, verifyTurnstile } from "./routes/contact.js";
import { verifyAccessJwt, type AccessIdentity } from "./access.js";
import { operationRoutes } from "./ops/route.js";
import { likeRoutes, photoLikeRoutes } from "./routes/likes.js";
import type { ProjectOperatorClient } from "@inquiry-platform/sdk";
import { createInquiryOperator } from "./inquiry-operator.js";
import { runStatusProbe } from "./status-probe.js";
import type { AuditContext } from "./audit.js";

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
    /**
     * Who passed the admin gate, as an opaque id for other systems' audit logs:
     * the Access subject, or `admin-token`. Never an address.
     */
    adminActor: string;
    auditContext: AuditContext;
  };
};

export interface AppOptions {
  /** Overridden by tests so the HTTP layer can run against in-memory adapters. */
  contextFactory?: (env: Env, requestId: string) => AppContext;
  verifyChallenge?: ChallengeVerifier;
  verifyAccess?: AccessVerifier;
  /** Overridden by tests so the inquiry screen runs against a stand-in platform. */
  inquiryOperator?: (env: Env) => ProjectOperatorClient | null;
  publishSite?: (env: Env, deferBuild?: boolean) => Promise<unknown>;
  /**
   * Set only for the app behind the `AdminOperator` entrypoint (operator.ts),
   * which nothing but a Service Binding can reach: the caller already proved
   * who it is, so the admin gate lets it in as this actor without a token.
   */
  operatorActor?: string;
  /** Set only by the private MCP Service Binding entrypoint. */
  operatorAuditContext?: AuditContext;
  /** In-memory D1 used by audit-specific tests. */
  auditDb?: SqlDatabase;
}

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

/**
 * HTTP adapter only: routing, authentication and response shaping. Every
 * decision about content lives in @tomokichi/application (instruction §7).
 */
export function createApp(options: AppOptions = {}) {
  const buildContext = options.contextFactory ?? createContext;
  const verifyChallenge = options.verifyChallenge ?? verifyTurnstile;
  const verifyAccess = options.verifyAccess ?? verifyAccessJwt;
  const inquiryOperator = options.inquiryOperator ?? ((env: Env) => createInquiryOperator(env));
  const publishSite =
    options.publishSite ??
    ((env: Env, deferBuild = false) => requestPublication(env, undefined, undefined, deferBuild));
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    const providedRequestId = c.req.header("x-request-id");
    const trustedBindingRequestId =
      options.operatorActor &&
      providedRequestId &&
      /^[A-Za-z0-9._:-]{1,100}$/.test(providedRequestId)
        ? providedRequestId
        : undefined;
    const requestId = trustedBindingRequestId ?? generateId();
    c.set("requestId", requestId);
    const ctx = buildContext(c.env, requestId);
    // Hono throws on `executionCtx` where the runtime gives none (tests).
    let defer: ((task: Promise<unknown>) => void) | undefined;
    try {
      const execution = c.executionCtx;
      defer = (task) => execution.waitUntil(task);
    } catch {
      defer = undefined;
    }
    c.set("ctx", defer && !ctx.defer ? { ...ctx, defer } : ctx);
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
      c.header("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      c.header("vary", "origin");
    }
    if (c.req.method === "OPTIONS") return c.body(null, 204);
    await next();
  });

  app.post("/webhooks/resend", (c) => resendWebhook(c.req.raw, c.env));

  // `/health` is deliberately unversioned: it answers "is this Worker up",
  // which is not a contract that can change shape.
  app.get("/health", (c) => c.json({ status: "ok", requestId: c.get("requestId") }));

  /*
   * Read-only state of the contact pipeline for the status platform. Without
   * the token configured, or with a wrong one, it answers exactly like a route
   * that does not exist.
   */
  app.get("/internal/status-probe", async (c) => {
    const expected = c.env.STATUS_PROBE_TOKEN?.trim();
    const provided = c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!expected || !secretsMatch(expected, provided)) {
      return errorResponse(c, "API_NOT_FOUND", `no route for ${c.req.path}`, 404);
    }
    const limiter = c.env.STATUS_PROBE_RATE_LIMITER;
    if (limiter && !(await limiter.limit({ key: "status-probe" })).success) {
      return c.json({ error: "rate_limited" }, 429, {
        "cache-control": "no-store",
        "retry-after": "60",
      });
    }
    const result = await runStatusProbe({
      operator: inquiryOperator(c.env),
      turnstileSecret: c.env.TURNSTILE_SECRET_KEY,
      now: Date.now(),
    });
    return c.json(result, 200, { "cache-control": "no-store" });
  });

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
  v1.route("/photo-likes", photoLikeRoutes());
  v1.route("/images", imageRoutes());

  // Everything below /admin requires the shared secret. A missing secret means
  // the admin API is closed, never open.
  /*
   * Admin access is granted by Cloudflare Access once it is configured, and by
   * the shared bearer token otherwise. Configuring Access does not silently
   * disable the token — remove `ADMIN_TOKEN` to make Access the only way in.
   */
  v1.use("/admin/*", async (c, next) => {
    if (options.operatorActor) {
      c.get("ctx").logger.info("admin.authenticated", { via: "operator-binding" });
      c.set("adminActor", options.operatorActor);
      c.set(
        "auditContext",
        options.operatorAuditContext ?? {
          actorType: "remote-operator",
          actorSubject: "unknown",
          source: "remote-mcp",
          clientTrust: "unknown",
        },
      );
      await next();
      return;
    }
    const teamDomain = c.env.ACCESS_TEAM_DOMAIN?.trim();
    const audience = c.env.ACCESS_AUD?.trim();
    const assertion = c.req.header("cf-access-jwt-assertion");

    if (teamDomain && audience && assertion) {
      const identity = await c.get("verifyAccess")(assertion, teamDomain, audience);
      if (identity) {
        c.get("ctx").logger.info("admin.authenticated", { via: "access", email: identity.email });
        const subject = identity.subject.replace(/[^A-Za-z0-9._:+-]/g, "").slice(0, 80);
        c.set("adminActor", subject ? `access:${subject}` : "access");
        c.set("auditContext", {
          actorType: "access-user",
          actorSubject: subject || null,
          source: "admin",
          clientName: "Tomokichi Diary Admin",
          clientTrust: "confirmed",
        });
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
    const localOperatorToken = c.env.LOCAL_OPERATOR_TOKEN?.trim();
    const adminToken = expected;
    if (
      localOperatorToken &&
      localOperatorToken !== adminToken &&
      provided &&
      secretsMatch(localOperatorToken, provided)
    ) {
      // The local operator runs operations only; which ones is the policy's call.
      if (!c.req.path.startsWith("/v1/admin/ops/"))
        return errorResponse(
          c,
          "API_UNAUTHORIZED",
          "this route is not available to the local operator",
          403,
        );
      c.set("adminActor", "local-operator");
      c.set("auditContext", {
        actorType: "local-operator",
        actorSubject: "local-operator",
        source: "local-mcp",
        clientName: "Tomokichi Diary Local Operator",
        clientTrust: "confirmed",
      });
      await next();
      return;
    }
    if (!expected || !provided || !secretsMatch(expected, provided)) {
      c.get("ctx").logger.warn("admin.unauthorized", {
        code: "API_UNAUTHORIZED",
        route: c.req.path,
      });
      return errorResponse(c, "API_UNAUTHORIZED", "a valid admin token is required", 401);
    }
    c.set("adminActor", "admin-token");
    c.set("auditContext", {
      actorType: "admin-token",
      actorSubject: "admin-token",
      source: "admin",
      clientTrust: "unknown",
    });
    await next();
  });

  /*
   * The whole admin surface: one route that runs a named operation. Who may
   * run it, input validation and the audit entry all follow from the
   * operation's definition (ops/route.ts, packages/contracts/operations).
   */
  v1.route(
    "/admin/ops",
    operationRoutes({
      publishSite,
      inquiryOperator,
      ...(options.auditDb ? { auditDb: options.auditDb } : {}),
      testContext: Boolean(options.contextFactory),
    }),
  );

  // The original file of a library photo, for the admin to download. Binary,
  // so it is a plain GET beside the operations rather than one of them.
  v1.get("/admin/media/:id/file", async (c) => {
    const ctx = c.get("ctx");
    const asset = await ctx.repos.media.findById(c.req.param("id") as MediaId);
    const object = asset ? await ctx.storage.get(asset.storageKey) : null;
    if (!asset || !object) return errorResponse(c, "MEDIA_NOT_FOUND", "image not found", 404);
    return c.body(object.body, 200, {
      "content-type": asset.mimeType,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
  });

  // Used only by the private MCP consent flow. A shared admin token is not a
  // human identity and must never authorize an OAuth grant.
  v1.get("/admin/analytics/connection-identity", (c) => {
    const actor = c.get("adminActor");
    if (!actor.startsWith("access:"))
      return errorResponse(c, "API_UNAUTHORIZED", "Access login required", 401);
    return c.json({ subject: actor.slice("access:".length) }, 200, {
      "cache-control": "private, no-store",
    });
  });

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
