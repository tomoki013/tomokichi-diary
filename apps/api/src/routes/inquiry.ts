import { Hono, type Context } from "hono";
import { validate, v } from "@tomokichi/contracts";
import type {
  InquirySignatureDto,
  InquiryStatusDto,
  InquiryTicketDetailDto,
  InquiryTicketStatus,
  InquiryTicketSummaryDto,
  PageDto,
} from "@tomokichi/contracts";
import type {
  IntakeResult,
  OperatorProject,
  OperatorTicketDetail,
  OperatorTicketSummary,
  ProjectOperatorClient,
} from "@inquiry-platform/sdk";
import type { AppEnv } from "../app.js";
import { errorResponse } from "../http.js";

/**
 * The admin's window onto this site's tickets on the shared inquiry platform.
 *
 * Mounted under `/v1/admin`, so this site's admin gate has already decided who
 * may be here. The platform's `ProjectOperator` binding does the rest: it
 * scopes every call to this site's project, applies the ticket rules, and
 * audits each change as this API and the person who passed the gate.
 * Bodies are rebuilt field by field, so the admin can do what this file names
 * and nothing else.
 */

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

/** Absent and null read the same to the validator; the handler tells them apart. */
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
/** Empty is allowed: it hands the project back to the deployment's signature. */
const signatureSchema = v.object({ signature: v.string({ max: 2000 }) });

type Ctx = Context<AppEnv>;
type Failure = Extract<IntakeResult<unknown>, { ok: false }>;

function failure(c: Ctx, result: Failure): Response {
  const { code, message } = result.error;
  switch (code) {
    case "NOT_FOUND":
      return errorResponse(c, "API_NOT_FOUND", "no such inquiry", 404);
    case "CONFLICT":
    case "INVALID_STATUS_TRANSITION":
      return errorResponse(c, "API_CONFLICT", message, 409);
    case "VALIDATION_ERROR":
      return errorResponse(c, "API_VALIDATION_FAILED", message, 400);
    case "UNAVAILABLE":
    case "FORBIDDEN":
      // The binding is missing or not granted this project: configuration,
      // not something the operator did.
      c.get("ctx").logger.error("inquiry.not_configured", { code: "API_INTERNAL" });
      return errorResponse(c, "API_INTERNAL", "the inquiry platform is not configured", 503);
    default:
      c.get("ctx").logger.error("inquiry.upstream_failed", { code: "API_INTERNAL" });
      return errorResponse(c, "API_INTERNAL", "the inquiry platform is unavailable", 502);
  }
}

function toSummary(ticket: OperatorTicketSummary): InquiryTicketSummaryDto {
  return {
    id: ticket.id,
    number: ticket.number,
    status: ticket.status,
    subject: ticket.subject,
    requesterEmail: ticket.requesterEmail,
    priority: ticket.priority,
    slaState: ticket.slaState,
    nextAction: ticket.nextAction,
    nextActionAt: ticket.nextActionAt,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  };
}

function toDetail(ticket: OperatorTicketDetail): InquiryTicketDetailDto {
  return {
    ...toSummary(ticket),
    revision: ticket.revision,
    resolution: ticket.resolution,
    acknowledgedAt: ticket.acknowledgedAt,
    resolvedAt: ticket.resolvedAt,
    closedAt: ticket.closedAt,
    allowedStatuses: ticket.allowedStatuses,
    canReply: ticket.canReply,
    timeline: ticket.timeline,
    totalTimeline: ticket.totalTimeline,
  };
}

/** The person who passed this site's admin gate, as the platform audits them. */
const who = (c: Ctx) => ({ id: c.get("adminActor") ?? "admin" });

const toSignature = (project: OperatorProject): InquirySignatureDto => ({
  signature: project.signature,
  usesDefault: project.signature.trim() === "",
});

export function inquiryRoutes(operatorFor: (c: Ctx) => ProjectOperatorClient | null) {
  const routes = new Hono<AppEnv>();

  /** The client, or the 503 explaining there is none. */
  const client = (c: Ctx): ProjectOperatorClient | Response =>
    operatorFor(c) ??
    errorResponse(c, "API_INTERNAL", "the inquiry platform is not configured", 503);

  routes.get("/status", async (c) => {
    const operator = operatorFor(c);
    if (!operator) {
      return c.json({
        configured: false,
        registered: false,
        mailConfigured: false,
      } satisfies InquiryStatusDto);
    }
    const project = await operator.project();
    if (!project.ok && project.error.code !== "NOT_FOUND") return failure(c, project);
    return c.json({
      configured: true,
      registered: project.ok,
      mailConfigured: project.ok && project.value.mailConfigured,
    } satisfies InquiryStatusDto);
  });

  /**
   * The signature under this site's replies. Without one of its own the
   * platform signs with the deployment's, which is why the admin shows it.
   */
  routes.get("/signature", async (c) => {
    const operator = client(c);
    if (operator instanceof Response) return operator;
    const project = await operator.project();
    return project.ok ? c.json(toSignature(project.value)) : failure(c, project);
  });

  routes.put("/signature", async (c) => {
    const parsed = validate(signatureSchema, await c.req.json().catch(() => null));
    if (!parsed.ok)
      return errorResponse(c, parsed.code, "invalid request body", 400, parsed.issues);
    const operator = client(c);
    if (operator instanceof Response) return operator;
    const saved = await operator.setSignature(parsed.value.signature, who(c));
    return saved.ok ? c.json(toSignature(saved.value)) : failure(c, saved);
  });

  routes.get("/tickets", async (c) => {
    const operator = client(c);
    if (operator instanceof Response) return operator;

    const status = c.req.query("status");
    const text = c.req.query("query")?.trim().slice(0, 200);
    const offset = Math.max(0, Math.floor(Number(c.req.query("offset")) || 0));
    const page = await operator.listTickets({
      ...(status === "open" || (STATUSES as readonly string[]).includes(status ?? "")
        ? { status: status as InquiryTicketStatus | "open" }
        : {}),
      ...(text ? { query: text } : {}),
      limit: PAGE_SIZE,
      offset,
    });
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

  /** `:id` is a ticket id or its number, as a notification link carries. */
  routes.get("/tickets/:id", async (c) => {
    const operator = client(c);
    if (operator instanceof Response) return operator;
    const offset = Math.max(0, Math.floor(Number(c.req.query("offset")) || 0));
    const ticket = await operator.getTicket(c.req.param("id"), offset);
    return ticket.ok ? c.json(toDetail(ticket.value)) : failure(c, ticket);
  });

  routes.patch("/tickets/:id", async (c) => {
    const raw: unknown = await c.req.json().catch(() => null);
    const parsed = validate(changeSchema, raw);
    if (!parsed.ok)
      return errorResponse(c, parsed.code, "invalid request body", 400, parsed.issues);
    const operator = client(c);
    if (operator instanceof Response) return operator;

    // Only what was sent: a status change must not clear the next action.
    const sent = (key: string): boolean => Object.hasOwn(raw as object, key);
    const change = parsed.value;
    const result = await operator.changeTicket(
      c.req.param("id"),
      {
        revision: change.revision,
        ...(change.status !== null ? { status: change.status } : {}),
        ...(change.resolution !== null ? { resolution: change.resolution } : {}),
        ...(sent("nextAction") ? { nextAction: change.nextAction } : {}),
        ...(sent("nextActionAt") ? { nextActionAt: change.nextActionAt } : {}),
      },
      who(c),
    );
    return result.ok ? c.json({ ok: true }) : failure(c, result);
  });

  routes.post("/tickets/:id/notes", async (c) => {
    const parsed = validate(noteSchema, await c.req.json().catch(() => null));
    if (!parsed.ok)
      return errorResponse(c, parsed.code, "invalid request body", 400, parsed.issues);
    const operator = client(c);
    if (operator instanceof Response) return operator;
    const result = await operator.addNote(c.req.param("id"), parsed.value, who(c));
    return result.ok ? c.json({ ok: true }) : failure(c, result);
  });

  /** Mails the person who wrote in. Recipient, sender and subject are the platform's. */
  routes.post("/tickets/:id/reply", async (c) => {
    const parsed = validate(replySchema, await c.req.json().catch(() => null));
    if (!parsed.ok)
      return errorResponse(c, parsed.code, "invalid request body", 400, parsed.issues);
    const operator = client(c);
    if (operator instanceof Response) return operator;
    const result = await operator.reply(c.req.param("id"), parsed.value, who(c));
    if (!result.ok) return failure(c, result);
    c.get("ctx").logger.info("inquiry.replied", { ticketId: result.value.id });
    return c.json({ ok: true });
  });

  return routes;
}
