import { Hono, type Context } from "hono";
import { validate, v } from "@tomokichi/contracts";
import { CONTACT_LANES, CONTACT_LANE_LABELS, findContactTopic } from "@tomokichi/domain";
import type {
  InquiryAppliedTemplateDto,
  InquiryReplyTemplateDto,
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
  OperatorReplyTemplate,
  OperatorTicketDetail,
  OperatorTicketSummary,
  ProjectOperatorClient,
} from "@inquiry-platform/sdk";
import type { AppEnv } from "../app.js";
import { errorResponse } from "../http.js";

/**
 * The admin's window onto this site's contacts on the shared inquiry
 * platform: where they are worked, annotated and answered. A reply is mailed
 * by the platform, which decides the recipient, sender and subject from the
 * ticket; only the body goes up from here.
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
  templateId: v.nullable(v.string({ min: 1, max: 200 })),
});
/** Empty is allowed: it hands the project back to the deployment's signature. */
const signatureSchema = v.object({ signature: v.string({ max: 2000 }) });
const templateSchema = v.object({
  name: v.string({ min: 1, max: 160 }),
  subject: v.nullable(v.string({ max: 200 })),
  body: v.string({ min: 1, max: 20_000 }),
  isActive: v.optional(v.boolean(), true),
  sortOrder: v.optional(v.number({ min: 0, max: 9999, integer: true }), 100),
});
const applySchema = v.object({ templateId: v.string({ min: 1, max: 200 }) });

/** `{{name}}` left in a reply: the platform refuses to send one. */
const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;
const unresolved = (text: string): string[] => [
  ...new Set([...text.matchAll(PLACEHOLDER)].map((match) => match[1] ?? "")),
];

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
    case "MAIL_ERROR":
      c.get("ctx").logger.error("inquiry.mail_failed", { code: "INQUIRY_MAIL_FAILED" });
      return errorResponse(c, "INQUIRY_MAIL_FAILED", "the reply could not be mailed", 502);
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
    lane: findContactTopic(ticket.subject)?.lane ?? null,
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
    receiptId: ticket.receiptId,
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

/** The platform's `key` is its handle, not something the admin chooses or sees. */
const toTemplate = (template: OperatorReplyTemplate): InquiryReplyTemplateDto => ({
  id: template.id,
  name: template.name,
  subject: template.subject,
  body: template.body,
  isActive: template.isActive,
  sortOrder: template.sortOrder,
  updatedAt: template.updatedAt,
});

const LANES = CONTACT_LANES.map((key) => ({ key, label: CONTACT_LANE_LABELS[key] }));

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
        lanes: LANES,
      } satisfies InquiryStatusDto);
    }
    const project = await operator.project();
    if (!project.ok && project.error.code !== "NOT_FOUND") return failure(c, project);
    return c.json({
      configured: true,
      registered: project.ok,
      mailConfigured: project.ok && project.value.mailConfigured,
      lanes: LANES,
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
    const saved = await operator.setSignature(parsed.value.signature.trim(), who(c));
    return saved.ok ? c.json(toSignature(saved.value)) : failure(c, saved);
  });

  /** This site's own templates, retired ones included so they can be brought back. */
  routes.get("/templates", async (c) => {
    const operator = client(c);
    if (operator instanceof Response) return operator;
    const templates = await operator.listTemplates({ includeInactive: true });
    if (!templates.ok) return failure(c, templates);
    const items = templates.value
      .map(toTemplate)
      .toSorted((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ja"));
    return c.json({ items });
  });

  routes.post("/templates", async (c) => {
    const parsed = validate(templateSchema, await c.req.json().catch(() => null));
    if (!parsed.ok)
      return errorResponse(c, parsed.code, "invalid request body", 400, parsed.issues);
    const operator = client(c);
    if (operator instanceof Response) return operator;
    const input = parsed.value;
    const created = await operator.createTemplate(
      {
        // The platform's stable handle; nothing here refers to it.
        key: `diary_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`,
        name: input.name.trim(),
        subject: input.subject?.trim() || null,
        body: input.body,
        isActive: input.isActive,
        sortOrder: input.sortOrder,
      },
      who(c),
    );
    return created.ok ? c.json(toTemplate(created.value), 201) : failure(c, created);
  });

  routes.patch("/templates/:id", async (c) => {
    const parsed = validate(templateSchema, await c.req.json().catch(() => null));
    if (!parsed.ok)
      return errorResponse(c, parsed.code, "invalid request body", 400, parsed.issues);
    const operator = client(c);
    if (operator instanceof Response) return operator;
    const input = parsed.value;
    const updated = await operator.updateTemplate(
      c.req.param("id"),
      {
        name: input.name.trim(),
        subject: input.subject?.trim() || null,
        body: input.body,
        isActive: input.isActive,
        sortOrder: input.sortOrder,
      },
      who(c),
    );
    return updated.ok ? c.json(toTemplate(updated.value)) : failure(c, updated);
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

  /** A template filled in for this ticket: the reader's name, the site's name and URL. */
  routes.post("/tickets/:id/apply-template", async (c) => {
    const parsed = validate(applySchema, await c.req.json().catch(() => null));
    if (!parsed.ok)
      return errorResponse(c, parsed.code, "invalid request body", 400, parsed.issues);
    const operator = client(c);
    if (operator instanceof Response) return operator;
    const applied = await operator.applyTemplate(c.req.param("id"), parsed.value.templateId);
    if (!applied.ok) return failure(c, applied);
    return c.json({
      body: applied.value.body,
      unresolved: unresolved(applied.value.body),
    } satisfies InquiryAppliedTemplateDto);
  });

  /** Mails the person who wrote in. Recipient, sender and subject are the platform's. */
  routes.post("/tickets/:id/reply", async (c) => {
    const parsed = validate(replySchema, await c.req.json().catch(() => null));
    if (!parsed.ok)
      return errorResponse(c, parsed.code, "invalid request body", 400, parsed.issues);
    // The platform refuses these too; saying which ones is what helps.
    const left = unresolved(parsed.value.body);
    if (left.length > 0) {
      return errorResponse(
        c,
        "API_VALIDATION_FAILED",
        `置き換えていない項目が残っています: ${left.map((name) => `{{${name}}}`).join(", ")}`,
        400,
      );
    }
    const operator = client(c);
    if (operator instanceof Response) return operator;
    const { templateId, ...reply } = parsed.value;
    const result = await operator.reply(
      c.req.param("id"),
      { ...reply, ...(templateId !== null ? { templateId } : {}) },
      who(c),
    );
    if (!result.ok) return failure(c, result);
    c.get("ctx").logger.info("inquiry.replied", { ticketId: result.value.id });
    return c.json({ ok: true });
  });

  return routes;
}
