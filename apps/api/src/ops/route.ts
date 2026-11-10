import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { MAX_UPLOAD_BYTES } from "@tomokichi/application";
import {
  findOperation,
  isOperationAllowed,
  validate,
  type OperationChannel,
  type OperationName,
  type SitePublicationStatus,
} from "@tomokichi/contracts";
import { fromD1, type SqlDatabase } from "@tomokichi/infra-d1";
import type { ProjectOperatorClient } from "@inquiry-platform/sdk";
import type { AppEnv } from "../app.js";
import { finishAuditEvent, insertAuditEvent, type AuditContext } from "../audit.js";
import type { Env } from "../env.js";
import { errorResponse } from "../http.js";
import { handlers } from "./handlers.js";
import { OpError, type OpScope } from "./scope.js";

export interface OperationRouteOptions {
  publishSite: (env: Env, deferBuild?: boolean) => Promise<unknown>;
  inquiryOperator: (env: Env) => ProjectOperatorClient | null;
  /** In-memory D1 for tests that have no `DB` binding. */
  auditDb?: SqlDatabase;
  /** True where a test injected the application context and may lack a database. */
  testContext: boolean;
}

/** Which side of the policy a caller is on, from what the admin gate established. */
export function channelOf(audit: AuditContext): { channel: OperationChannel; writes: boolean } {
  if (audit.source === "admin") return { channel: "admin", writes: true };
  if (audit.source === "local-mcp") return { channel: "operator", writes: true };
  return audit.actorType === "remote-analytics"
    ? { channel: "analytics", writes: false }
    : { channel: "operator", writes: audit.operatorWrite === true };
}

const idOf = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value.slice(0, 120) : null;

/**
 * The admin API: `POST /v1/admin/ops/<name>` with the operation's input as
 * JSON. Who may run what, validation and the audit trail are decided here,
 * once, from the operation's own definition (packages/contracts/operations).
 */
export function operationRoutes(options: OperationRouteOptions) {
  const routes = new Hono<AppEnv>();

  routes.use(
    "/media.upload",
    bodyLimit({
      // Base64 is a third larger than the file it carries.
      maxSize: Math.ceil(MAX_UPLOAD_BYTES * 1.4) + 64 * 1024,
      onError: (c) =>
        errorResponse(
          c,
          "API_VALIDATION_FAILED",
          "画像は20MB以下のファイルを指定してください",
          400,
        ),
    }),
  );

  routes.post("/:name", async (c) => {
    const name = c.req.param("name");
    const spec = findOperation(name);
    if (!spec) return errorResponse(c, "API_NOT_FOUND", `no operation ${name}`, 404);

    const audit = c.get("auditContext");
    const { channel, writes } = channelOf(audit);
    if (!isOperationAllowed(spec, channel, writes)) {
      c.get("ctx").logger.warn("operation.refused", { code: "API_FORBIDDEN", name, channel });
      return errorResponse(c, "API_FORBIDDEN", "この接続ではこの操作を実行できません", 403);
    }

    let raw: unknown;
    let upload: OpScope["upload"];
    if (c.req.header("content-type")?.startsWith("multipart/form-data")) {
      const form = await c.req.formData().catch(() => null);
      const file: unknown = form?.get("file");
      if (!form || !(file instanceof File))
        return errorResponse(c, "API_VALIDATION_FAILED", "a `file` field is required", 400);
      upload = { body: await file.arrayBuffer(), mimeType: file.type, name: file.name };
      raw = { slug: form.get("slug"), filename: file.name, mimeType: file.type };
    } else {
      const text = (await c.req.text()).trim();
      try {
        raw = text === "" ? {} : JSON.parse(text);
      } catch {
        return errorResponse(c, "API_VALIDATION_FAILED", "invalid JSON body", 400);
      }
    }
    const parsed = validate(spec.input, raw);
    if (!parsed.ok)
      return errorResponse(c, parsed.code, "invalid operation input", 400, parsed.issues);
    const input = parsed.value as Record<string, unknown>;

    const db = (): SqlDatabase => {
      if (options.auditDb) return options.auditDb;
      if (!c.env.DB) throw new OpError("API_INTERNAL", "the database is unavailable", 503);
      return fromD1(c.env.DB);
    };
    const scope: OpScope = {
      ctx: c.get("ctx"),
      env: c.env,
      actor: c.get("adminActor"),
      audit,
      channel,
      publishSite: (deferBuild = false) =>
        options.publishSite(c.env, deferBuild) as Promise<SitePublicationStatus>,
      inquiry: () => options.inquiryOperator(c.env),
      db,
      ...(upload ? { upload } : {}),
    };

    // The owner's own reads are not logged; everything else is, before it runs,
    // so a failed audit store blocks the operation instead of hiding it.
    const audited = spec.kind !== "read" || channel !== "admin";
    const auditDb = audited
      ? (options.auditDb ?? (c.env.DB ? fromD1(c.env.DB) : undefined))
      : undefined;
    if (audited && !auditDb && !options.testContext)
      return errorResponse(c, "API_INTERNAL", "operation audit is unavailable", 503);
    const eventId = crypto.randomUUID();
    if (auditDb) {
      let context = audit;
      try {
        if (audit.clientId && audit.clientRedirectHost) {
          const alias = await auditDb
            .prepare(
              "SELECT display_name FROM operator_audit_client_names WHERE client_id=? AND redirect_host=?",
            )
            .bind(audit.clientId, audit.clientRedirectHost)
            .first<{ display_name: string }>();
          if (alias)
            context = { ...audit, clientName: alias.display_name, clientTrust: "confirmed" };
        }
        await insertAuditEvent(auditDb, {
          ...context,
          id: eventId,
          occurredAt: new Date().toISOString(),
          requestId: c.get("requestId"),
          action: name,
          targetType: spec.target.type,
          targetId: spec.target.idField ? idOf(input[spec.target.idField]) : null,
          result: "requested",
          statusCode: null,
          metadata: spec.publishes ? { phase: "request" } : {},
        });
      } catch (error) {
        c.get("ctx").logger.error("audit.write_failed", {
          action: name,
          error: error instanceof Error ? error.message : "unknown",
        });
        return errorResponse(c, "API_INTERNAL", "operation audit is unavailable", 503);
      }
    }

    let response: Response;
    let output: unknown;
    let thrown: unknown;
    try {
      const run = handlers[name as OperationName] as (
        scope: OpScope,
        input: unknown,
      ) => Promise<unknown>;
      output = await run(scope, input);
      response = c.json(output ?? null, 200, { "cache-control": "private, no-store" });
    } catch (error) {
      if (error instanceof OpError) {
        response = errorResponse(c, error.code, error.message, error.status, error.issues);
      } else {
        thrown = error;
        response = errorResponse(c, "API_INTERNAL", "internal error", 500);
      }
    }

    if (auditDb) {
      const status = response.status;
      const body = (output ?? {}) as {
        id?: unknown;
        requestId?: unknown;
        publication?: { requestId?: unknown } | null;
      };
      const publicationId =
        spec.publishes && status < 400 ? idOf(body.publication?.requestId ?? body.requestId) : null;
      try {
        await finishAuditEvent(
          auditDb,
          eventId,
          status >= 500
            ? "failed"
            : status >= 400
              ? "rejected"
              : spec.publishes && publicationId
                ? "requested"
                : "succeeded",
          status,
          publicationId ?? undefined,
          spec.target.idField ? undefined : (idOf(body.id) ?? undefined),
        );
      } catch (error) {
        c.get("ctx").logger.error("audit.finalize_failed", {
          auditId: eventId,
          error: error instanceof Error ? error.message : "unknown",
        });
        if (!thrown && status < 400)
          return errorResponse(c, "API_INTERNAL", "operation audit finalization failed", 503);
      }
    }
    if (thrown) throw thrown;
    return response;
  });

  return routes;
}
