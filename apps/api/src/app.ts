import { resendWebhook } from "./resend-webhook.js";
import { monetizationRoutes } from "./routes/monetization.js";
import { Hono } from "hono";
import type { AppContext } from "@tomokichi/application";
import { fromD1, type SqlDatabase } from "@tomokichi/infra-d1";
import { generateId } from "@tomokichi/domain";
import type { Env } from "./env.js";
import { errorResponse } from "./http.js";
import { createContext } from "./context.js";
import { analyticsRoutes } from "./routes/analytics.js";
import { activityRoutes } from "./routes/activity.js";
import { connectionRoutes } from "./routes/connections.js";
import { articleRoutes } from "./routes/articles.js";
import { diaryNoteRoutes } from "./routes/notes.js";
import { publicationRoutes, requestPublication } from "./publication.js";
import { mediaRoutes } from "./routes/media.js";
import { collectionRoutes } from "./routes/collections.js";
import { rankingRoutes } from "./routes/rankings.js";
import { imageRoutes } from "./routes/images.js";
import { referenceRoutes } from "./routes/reference.js";
import { routeRoutes } from "./routes/routes.js";
import { contactRoutes, verifyTurnstile } from "./routes/contact.js";
import { verifyAccessJwt, type AccessIdentity } from "./access.js";
import { isAllowedOperatorRequest } from "./operator-policy.js";
import { messageRoutes } from "./routes/messages.js";
import { likeAdminRoutes, likeRoutes, photoLikeRoutes } from "./routes/likes.js";
import { knowledgeRoutes } from "./routes/knowledge.js";
import { inquiryRoutes } from "./routes/inquiry.js";
import type { ProjectOperatorClient } from "@inquiry-platform/sdk";
import { createInquiryOperator } from "./inquiry-operator.js";
import { runStatusProbe } from "./status-probe.js";
import {
  finishAuditEvent,
  insertAuditEvent,
  type AuditContext,
  type AuditEventInput,
} from "./audit.js";

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
      if (!isAllowedOperatorRequest(c.req.raw, true))
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

  // Common audit coverage for every management API mutation. Remote MCP reads
  // are included too, with the server-verified tool and client context.
  v1.use("/admin/*", async (c, next) => {
    const context = c.get("auditContext");
    const method = c.req.method.toUpperCase();
    const shouldAudit =
      ["POST", "PUT", "PATCH", "DELETE"].includes(method) ||
      context.source === "remote-mcp" ||
      context.source === "local-mcp";
    if (!shouldAudit) {
      await next();
      return;
    }
    const auditDb =
      options.auditDb ?? (!options.contextFactory && c.env.DB ? fromD1(c.env.DB) : undefined);
    // Unit fixtures inject the application context but not a D1 binding. The
    // deployed Worker always has DB; a missing production binding fails closed.
    if (!auditDb) {
      if (options.contextFactory) {
        await next();
        return;
      }
      return errorResponse(c, "API_INTERNAL", "operation audit is unavailable", 503);
    }
    let resolvedContext = context;
    if (context.clientId && context.clientRedirectHost) {
      try {
        const alias = await auditDb
          .prepare(
            "SELECT display_name FROM operator_audit_client_names WHERE client_id=? AND redirect_host=?",
          )
          .bind(context.clientId, context.clientRedirectHost)
          .first<{ display_name: string }>();
        if (alias)
          resolvedContext = {
            ...context,
            clientName: alias.display_name,
            clientTrust: "confirmed",
          };
      } catch {
        return errorResponse(c, "API_INTERNAL", "client identity lookup failed", 503);
      }
    }

    const parts = new URL(c.req.url).pathname.split("/").filter(Boolean).slice(2);
    const resource = (parts[0] ?? "admin").replace(/[^a-z0-9-]/gi, "").slice(0, 40);
    const targetType =
      (
        {
          articles: "article",
          notes: "note",
          collections: "series",
          tags: "tag",
          rankings: "ranking",
          monetization: "ad",
          publication: "publication",
          connections: "connection",
        } as Record<string, string>
      )[resource] ?? resource;
    const routeMarkers = new Set([
      "retry",
      "publish",
      "unpublish",
      "archive",
      "draft",
      "relations",
      "publish-check",
      "body-audit",
      "taxonomy",
      "experiments",
      "articles",
      "offers",
      "settings",
      "article",
      "route",
      "date",
      "related-articles",
      "schedule",
      "cancel-schedule",
      "media",
      "revoke",
    ]);
    const targetId =
      (resource === "connections"
        ? parts[2]
        : parts.slice(1).find((part) => !routeMarkers.has(part))
      )?.slice(0, 120) ?? null;
    const routeAction = parts
      .slice(1)
      .filter((part) => routeMarkers.has(part))
      .join(".");
    const action = `${method.toLowerCase()}.${resource}${routeAction ? `.${routeAction.replace(/[^a-z0-9.-]/gi, "").slice(0, 80)}` : ""}`;
    const isToolInvocation =
      resolvedContext.source === "remote-mcp" && !!resolvedContext.mcpToolName;
    const asynchronousPublication =
      method !== "GET" &&
      (resource === "publication" || /(^|\.)(publish|unpublish|archive)(\.|$)/.test(action));
    const event: AuditEventInput = {
      ...resolvedContext,
      id: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      requestId: c.get("requestId"),
      action: isToolInvocation ? `mcp.tool.${resolvedContext.mcpToolName}` : action,
      targetType,
      targetId,
      result: "requested",
      statusCode: null,
      metadata: {
        ...(resolvedContext.source === "remote-mcp" ? { apiAction: action } : {}),
        ...(asynchronousPublication ? { phase: "request" } : {}),
      },
    };
    try {
      await insertAuditEvent(auditDb, event);
    } catch (error) {
      c.get("ctx").logger.error("audit.write_failed", {
        requestId: event.requestId,
        action: event.action,
        error: error instanceof Error ? error.message : "unknown",
      });
      return errorResponse(c, "API_INTERNAL", "operation audit is unavailable", 503);
    }

    let thrown: unknown;
    try {
      await next();
    } catch (error) {
      thrown = error;
    }
    const statusCode = thrown ? 500 : c.res.status;
    let publicationId: string | undefined;
    let responseTargetId: string | undefined;
    if (!thrown && statusCode < 400 && (asynchronousPublication || !targetId)) {
      const response = (await c.res
        .clone()
        .json()
        .catch(() => null)) as {
        id?: unknown;
        requestId?: unknown;
        publication?: { requestId?: unknown };
      } | null;
      if (!targetId && typeof response?.id === "string")
        responseTargetId = response.id.slice(0, 120);
      const candidate = response?.publication?.requestId ?? response?.requestId;
      if (asynchronousPublication && typeof candidate === "string")
        publicationId = candidate.slice(0, 100);
    }
    const result =
      statusCode >= 500
        ? "failed"
        : statusCode >= 400
          ? "rejected"
          : asynchronousPublication
            ? "requested"
            : "succeeded";
    try {
      await finishAuditEvent(
        auditDb,
        event.id,
        result,
        statusCode,
        publicationId,
        responseTargetId,
      );
    } catch (error) {
      c.get("ctx").logger.error("audit.finalize_failed", {
        requestId: event.requestId,
        auditId: event.id,
        error: error instanceof Error ? error.message : "unknown",
      });
      if (!thrown)
        return errorResponse(c, "API_INTERNAL", "operation audit finalization failed", 503);
    }
    if (thrown) throw thrown;
  });

  v1.route("/admin/activity", activityRoutes());
  v1.route("/admin/connections", connectionRoutes());
  v1.route("/admin/analytics", analyticsRoutes());
  v1.route("/admin/monetization", monetizationRoutes());
  v1.route("/admin/articles", articleRoutes(publishSite));
  v1.route("/admin/notes", diaryNoteRoutes(publishSite));
  v1.route("/admin/publication", publicationRoutes(publishSite));
  v1.route("/admin/media", mediaRoutes());
  v1.route("/admin/likes", likeAdminRoutes());
  v1.route("/admin/routes", routeRoutes());
  v1.route("/admin/messages", messageRoutes());
  v1.route("/admin/knowledge", knowledgeRoutes());
  v1.route("/admin/rankings", rankingRoutes());
  v1.route(
    "/admin/inquiry",
    inquiryRoutes((c) => inquiryOperator(c.env)),
  );
  v1.route("/admin", collectionRoutes());
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
