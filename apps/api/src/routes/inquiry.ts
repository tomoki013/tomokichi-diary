import { Hono, type Context } from "hono";
import { validate, v } from "@tomokichi/contracts";
import type {
  InquiryStatusDto,
  InquiryTicketDetailDto,
  InquiryTicketStatus,
  InquiryTicketSummaryDto,
  InquiryTimelineItemDto,
  PageDto,
} from "@tomokichi/contracts";
import type { AppEnv } from "../app.js";
import { errorResponse } from "../http.js";
import type {
  InquiryOperator,
  OperatorFailure,
  PlatformTicket,
  PlatformTicketDetail,
} from "../inquiry-operator.js";

/**
 * The admin's window onto this site's tickets on the shared inquiry platform.
 *
 * Mounted under `/v1/admin`, so the admin gate has already run. Every call is
 * scoped to the site's own project: a list is always filtered by it, and a
 * ticket from any other project answers 404 exactly as a missing one would.
 * Bodies are rebuilt field by field rather than passed through, so the admin
 * can do what this file names and nothing else the platform offers.
 */

/** Mirrors the platform's state machine. The platform enforces it; this only
 * decides which buttons to show. */
const TRANSITIONS: Record<InquiryTicketStatus, readonly InquiryTicketStatus[]> = {
  NEW: ["TRIAGE", "ACKNOWLEDGED", "RESOLVED"],
  TRIAGE: ["ACKNOWLEDGED", "RESOLVED"],
  ACKNOWLEDGED: ["IN_PROGRESS", "RESOLVED"],
  IN_PROGRESS: ["WAITING_CUSTOMER", "WAITING_INTERNAL", "RESOLVED"],
  WAITING_CUSTOMER: ["IN_PROGRESS", "RESOLVED"],
  WAITING_INTERNAL: ["IN_PROGRESS", "RESOLVED"],
  RESOLVED: ["CLOSED", "IN_PROGRESS"],
  CLOSED: ["IN_PROGRESS"],
};

const STATUSES = [
  "NEW",
  "TRIAGE",
  "ACKNOWLEDGED",
  "IN_PROGRESS",
  "WAITING_CUSTOMER",
  "WAITING_INTERNAL",
  "RESOLVED",
  "CLOSED",
] as const satisfies readonly InquiryTicketStatus[];
const RESOLUTIONS = [
  "RESOLVED",
  "NO_ACTION_REQUIRED",
  "SPAM",
  "DUPLICATE",
  "INVALID",
  "USER_WITHDREW",
  "OTHER",
] as const;
const PAGE_SIZE = 30;

/** Absent and null read the same to the validator; `changeBody` tells them apart. */
const changeSchema = v.object({
  revision: v.number({ min: 0, integer: true }),
  status: v.nullable(v.literalUnion(STATUSES)),
  resolution: v.nullable(v.literalUnion(RESOLUTIONS)),
  nextAction: v.nullable(v.string({ max: 4000 })),
  nextActionAt: v.nullable(v.string({ min: 20, max: 40 })),
});
const noteSchema = v.object({
  body: v.string({ min: 1, max: 100_000 }),
  idempotencyKey: v.string({ min: 8, max: 200 }),
});
const replySchema = v.object({
  body: v.string({ min: 1, max: 100_000 }),
  idempotencyKey: v.string({ min: 8, max: 200 }),
  reopenIfResolved: v.optional(v.boolean(), false),
});

type Ctx = Context<AppEnv>;

const json = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

function failure(c: Ctx, result: OperatorFailure): Response {
  switch (result.kind) {
    case "not_configured":
    case "not_registered":
      return errorResponse(c, "API_INTERNAL", result.message, 503);
    case "not_found":
      return errorResponse(c, "API_NOT_FOUND", "no such inquiry", 404);
    case "conflict":
      return errorResponse(c, "API_CONFLICT", result.message, 409);
    case "rejected":
      return errorResponse(
        c,
        "API_VALIDATION_FAILED",
        result.message,
        400,
        Object.entries(result.fields ?? {}).map(([path, message]) => ({ path, message })),
      );
    default:
      // Nothing about the upstream failure beyond its own message.
      c.get("ctx").logger.error("inquiry.upstream_failed", { code: "API_INTERNAL" });
      return errorResponse(c, "API_INTERNAL", "the inquiry platform is unavailable", 502);
  }
}

function toSummary(ticket: PlatformTicket): InquiryTicketSummaryDto {
  return {
    id: ticket.id,
    number: ticket.ticket_number,
    status: ticket.status,
    subject: ticket.subject,
    requesterEmail: ticket.requester_email,
    priority: ticket.priority,
    slaState: ticket.sla_state,
    nextAction: ticket.next_action,
    nextActionAt: ticket.next_action_at,
    createdAt: ticket.created_at,
    updatedAt: ticket.updated_at,
  };
}

function toDetail(detail: PlatformTicketDetail): InquiryTicketDetailDto {
  const { ticket } = detail;
  const timeline: InquiryTimelineItemDto[] = detail.timeline.map((item) =>
    item.kind === "message"
      ? {
          kind: "message",
          id: item.value.id,
          direction:
            item.value.visibility === "INTERNAL"
              ? "note"
              : item.value.direction === "INBOUND"
                ? "inbound"
                : "outbound",
          sender: item.value.sender,
          body: item.value.body,
          createdAt: item.value.created_at,
        }
      : {
          kind: "event",
          id: item.value.id,
          type: item.value.event_type,
          createdAt: item.value.created_at,
        },
  );
  return {
    ...toSummary(ticket),
    revision: ticket.revision,
    resolution: ticket.resolution,
    acknowledgedAt: ticket.acknowledged_at,
    resolvedAt: ticket.resolved_at,
    closedAt: ticket.closed_at,
    allowedStatuses: TRANSITIONS[ticket.status] ?? [],
    canReply: ticket.thread_id !== null && ticket.requester_email !== null,
    timeline,
    totalTimeline: detail.totalTimeline,
  };
}

export function inquiryRoutes(operatorFor: (c: Ctx) => InquiryOperator | null) {
  const routes = new Hono<AppEnv>();

  /** The operator and this site's project id, or the response explaining their absence. */
  async function scope(
    c: Ctx,
  ): Promise<{ operator: InquiryOperator; projectId: string } | Response> {
    const operator = operatorFor(c);
    if (!operator) {
      return failure(c, {
        ok: false,
        kind: "not_configured",
        message: "the inquiry platform is not configured",
      });
    }
    const projectId = await operator.projectId();
    return projectId.ok ? { operator, projectId: projectId.value } : failure(c, projectId);
  }

  /** A ticket of this site's, or a 404 indistinguishable from a missing one. */
  async function scopedTicket(
    c: Ctx,
    offset = 0,
  ): Promise<{ operator: InquiryOperator; detail: PlatformTicketDetail; id: string } | Response> {
    const scoped = await scope(c);
    if (scoped instanceof Response) return scoped;
    const id = c.req.param("id") ?? "";
    const detail = await scoped.operator.request<PlatformTicketDetail>(
      `/api/tickets/${encodeURIComponent(id)}?offset=${offset}`,
    );
    if (!detail.ok) return failure(c, detail);
    if (detail.value.ticket.service_id !== scoped.projectId) {
      return failure(c, { ok: false, kind: "not_found", message: "no such inquiry" });
    }
    return { operator: scoped.operator, detail: detail.value, id };
  }

  routes.get("/status", async (c) => {
    const operator = operatorFor(c);
    const body: InquiryStatusDto = {
      configured: operator !== null,
      registered: false,
      mailConfigured: false,
    };
    if (!operator) return c.json(body);

    const [projectId, session] = await Promise.all([
      operator.projectId(),
      operator.request<{ mailConfigured: boolean }>("/api/session"),
    ]);
    if (!projectId.ok && projectId.kind !== "not_registered") return failure(c, projectId);
    return c.json({
      ...body,
      registered: projectId.ok,
      mailConfigured: session.ok && session.value.mailConfigured,
    } satisfies InquiryStatusDto);
  });

  routes.get("/tickets", async (c) => {
    const scoped = await scope(c);
    if (scoped instanceof Response) return scoped;

    const query = new URLSearchParams({ service_id: scoped.projectId, limit: String(PAGE_SIZE) });
    const status = c.req.query("status");
    if (status === "open") query.set("queue", "OPEN");
    else if (status && (STATUSES as readonly string[]).includes(status))
      query.set("status", status);
    const text = c.req.query("query")?.trim().slice(0, 200);
    if (text) query.set("query", text);
    const offset = Math.max(0, Math.floor(Number(c.req.query("offset")) || 0));
    query.set("offset", String(offset));

    const page = await scoped.operator.request<{ items: PlatformTicket[]; total: number }>(
      `/api/tickets?${query}`,
    );
    if (!page.ok) return failure(c, page);
    const body: PageDto<InquiryTicketSummaryDto> = {
      items: page.value.items.map(toSummary),
      total: page.value.total,
      offset,
      limit: PAGE_SIZE,
      hasMore: offset + page.value.items.length < page.value.total,
    };
    return c.json(body);
  });

  routes.get("/tickets/:id", async (c) => {
    const offset = Math.max(0, Math.floor(Number(c.req.query("offset")) || 0));
    const scoped = await scopedTicket(c, offset);
    if (scoped instanceof Response) return scoped;
    return c.json(toDetail(scoped.detail));
  });

  routes.patch("/tickets/:id", async (c) => {
    const raw: unknown = await c.req.json().catch(() => null);
    const parsed = validate(changeSchema, raw);
    if (!parsed.ok)
      return errorResponse(c, parsed.code, "invalid request body", 400, parsed.issues);
    const scoped = await scopedTicket(c);
    if (scoped instanceof Response) return scoped;

    // Only what was sent: a status change must not clear the next action.
    const sent = (key: string): boolean => Object.hasOwn(raw as object, key);
    const change = parsed.value;
    const result = await scoped.operator.request<unknown>(
      `/api/tickets/${encodeURIComponent(scoped.id)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          revision: change.revision,
          ...(change.status !== null ? { status: change.status } : {}),
          ...(change.resolution !== null ? { resolution: change.resolution } : {}),
          ...(sent("nextAction") ? { next_action: change.nextAction } : {}),
          ...(sent("nextActionAt") ? { next_action_at: change.nextActionAt } : {}),
        }),
      },
    );
    if (!result.ok) return failure(c, result);
    return c.json({ ok: true });
  });

  routes.post("/tickets/:id/notes", async (c) => {
    const parsed = validate(noteSchema, await c.req.json().catch(() => null));
    if (!parsed.ok)
      return errorResponse(c, parsed.code, "invalid request body", 400, parsed.issues);
    const scoped = await scopedTicket(c);
    if (scoped instanceof Response) return scoped;

    const result = await scoped.operator.request<unknown>(
      `/api/tickets/${encodeURIComponent(scoped.id)}/notes`,
      json({ body: parsed.value.body, idempotencyKey: parsed.value.idempotencyKey }),
    );
    if (!result.ok) return failure(c, result);
    return c.json({ ok: true });
  });

  /**
   * Sends mail to the person who wrote in. Only a body goes up: the recipient,
   * sender and subject are the platform's to decide from the thread.
   */
  routes.post("/tickets/:id/reply", async (c) => {
    const parsed = validate(replySchema, await c.req.json().catch(() => null));
    if (!parsed.ok)
      return errorResponse(c, parsed.code, "invalid request body", 400, parsed.issues);
    const scoped = await scopedTicket(c);
    if (scoped instanceof Response) return scoped;

    const threadId = scoped.detail.ticket.thread_id;
    if (threadId === null || scoped.detail.ticket.requester_email === null) {
      return errorResponse(c, "API_CONFLICT", "this inquiry has no address to reply to", 409);
    }
    const result = await scoped.operator.request<unknown>(
      `/api/support/threads/${encodeURIComponent(threadId)}/reply`,
      json({
        bodyText: parsed.value.body,
        idempotencyKey: parsed.value.idempotencyKey,
        reopenIfResolved: parsed.value.reopenIfResolved,
      }),
    );
    if (!result.ok) return failure(c, result);
    c.get("ctx").logger.info("inquiry.replied", { ticketId: scoped.id });
    return c.json({ ok: true });
  });

  return routes;
}
