import { Hono, type Context } from "hono";
import { validate, v } from "@tomokichi/contracts";
import { CONTACT_LANES, CONTACT_LANE_LABELS, findContactTopic } from "@tomokichi/domain";
import type {
  InquiryAppliedTemplateDto,
  InquiryComposeDto,
  InquiryCountsDto,
  InquiryReplyTemplateDto,
  InquirySignatureDto,
  InquiryStatusDto,
  InquiryTicketDetailDto,
  InquiryTicketPageDto,
  InquiryTicketStatus,
  InquiryTicketSummaryDto,
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
import {
  DEFAULT_SUBJECT,
  OPENING_KEY,
  REPLY_CLOSING,
  REPLY_FROM,
  SUBJECT_KEY,
  ensureSignature,
  ensureTemplates,
  isPickable,
} from "../inquiry-templates.js";

/**
 * The admin's inbox for this site's contacts on the shared inquiry platform:
 * where they are listed, worked as tickets, annotated and answered. A reply is
 * mailed by the platform, which decides the recipient and sender from the
 * ticket; the body and, for a first reply, the subject go up from here.
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
const PAGE_SIZE = 50;
/** The platform pages by at most 100; a personal blog's inbox fits well under the cap. */
const SCAN_PAGE = 100;
const SCAN_CAP = 2000;

const isOpen = (status: InquiryTicketStatus): boolean =>
  status !== "RESOLVED" && status !== "CLOSED";

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
  /** Used only where the subject is still the site's to choose. */
  subject: v.nullable(v.string({ max: 200 })),
  /** Where the ticket goes once the reply is out; null leaves it in progress. */
  afterStatus: v.nullable(v.literalUnion(["WAITING_CUSTOMER", "RESOLVED"] as const)),
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

const unavailable = (c: Ctx): Response => {
  c.get("ctx").logger.error("inquiry.upstream_failed", { code: "API_INTERNAL" });
  return errorResponse(c, "API_INTERNAL", "the inquiry platform is unavailable", 502);
};

const laneOf = (subject: string) => findContactTopic(subject)?.lane ?? null;

function toSummary(ticket: OperatorTicketSummary): InquiryTicketSummaryDto {
  return {
    id: ticket.id,
    number: ticket.number,
    status: ticket.status,
    subject: ticket.subject,
    lane: laneOf(ticket.subject),
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
  role: template.key === OPENING_KEY ? "opening" : "reply",
  name: template.name,
  subject: template.subject,
  body: template.body,
  isActive: template.isActive,
  sortOrder: template.sortOrder,
  updatedAt: template.updatedAt,
});

const LANES = CONTACT_LANES.map((key) => ({ key, label: CONTACT_LANE_LABELS[key] }));

/** Open first, the newest of each first: what still needs doing reads top-down. */
const inboxOrder = (a: OperatorTicketSummary, b: OperatorTicketSummary): number =>
  Number(isOpen(b.status)) - Number(isOpen(a.status)) || b.createdAt.localeCompare(a.createdAt);

function countAll(tickets: readonly OperatorTicketSummary[]): InquiryCountsDto {
  const openByLane: Record<string, number> = Object.fromEntries(LANES.map(({ key }) => [key, 0]));
  const byStatus: Partial<Record<InquiryTicketStatus, number>> = {};
  let open = 0;
  let overdue = 0;
  for (const ticket of tickets) {
    byStatus[ticket.status] = (byStatus[ticket.status] ?? 0) + 1;
    if (!isOpen(ticket.status)) continue;
    open += 1;
    if (ticket.slaState === "BREACHED") overdue += 1;
    const lane = laneOf(ticket.subject);
    if (lane) openByLane[lane] = (openByLane[lane] ?? 0) + 1;
  }
  return {
    all: tickets.length,
    open,
    new: byStatus.NEW ?? 0,
    overdue,
    openByLane,
    byStatus,
  };
}

/** Every ticket the search matches, read in the platform's largest pages. */
async function everything(
  operator: ProjectOperatorClient,
  query: string | undefined,
): Promise<IntakeResult<OperatorTicketSummary[]>> {
  const items: OperatorTicketSummary[] = [];
  for (let offset = 0; offset < SCAN_CAP; offset += SCAN_PAGE) {
    const page = await operator.listTickets({
      ...(query ? { query } : {}),
      limit: SCAN_PAGE,
      offset,
    });
    if (!page.ok) return page;
    items.push(...page.value.items);
    if (page.value.items.length < SCAN_PAGE || items.length >= page.value.total) break;
  }
  return { ok: true, value: items };
}

/** This site's templates with the defaults in place, or null when the platform is down. */
const templatesOf = (operator: ProjectOperatorClient) =>
  ensureTemplates(operator).catch(() => null);

/**
 * The subject a reply to this ticket would go out with, and whether it is
 * still this site's to choose. The platform answers with the subject carrier's
 * own subject exactly when the conversation has none of its own yet — a
 * form message that has not been answered. After that it is `Re:` whatever
 * the first reply said, whatever template is named.
 */
async function subjectOf(
  operator: ProjectOperatorClient,
  ticketId: string,
  carrier: OperatorReplyTemplate,
): Promise<IntakeResult<{ subject: string; editable: boolean }>> {
  const probe = await operator.applyTemplate(ticketId, carrier.id);
  if (!probe.ok) return probe;
  const editable = probe.value.subject === carrier.subject;
  return { ok: true, value: { subject: probe.value.subject, editable } };
}

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
    const templates = await templatesOf(operator);
    if (!templates) return unavailable(c);
    const items = templates
      .filter((template) => template.key !== SUBJECT_KEY)
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

  /**
   * The whole inbox: every ticket, counted, then narrowed by status
   * (`open`, one status, or all when absent) and lane. Read in full so the
   * counts and the lane filter are exact; the platform cannot filter by lane.
   */
  routes.get("/tickets", async (c) => {
    const operator = client(c);
    if (operator instanceof Response) return operator;

    const status = c.req.query("status") ?? "";
    const lane = c.req.query("lane") ?? "";
    const text = c.req.query("query")?.trim().slice(0, 200);
    const offset = Math.max(0, Math.floor(Number(c.req.query("offset")) || 0));
    const all = await everything(operator, text || undefined);
    if (!all.ok) return failure(c, all);

    const matching = all.value
      .filter((ticket) =>
        status === "open"
          ? isOpen(ticket.status)
          : (STATUSES as readonly string[]).includes(status)
            ? ticket.status === status
            : true,
      )
      .filter((ticket) =>
        (CONTACT_LANES as readonly string[]).includes(lane)
          ? laneOf(ticket.subject) === lane
          : true,
      )
      .toSorted(inboxOrder);
    const items = matching.slice(offset, offset + PAGE_SIZE).map(toSummary);
    const body: InquiryTicketPageDto = {
      items,
      total: matching.length,
      offset,
      limit: PAGE_SIZE,
      hasMore: offset + items.length < matching.length,
      counts: countAll(all.value),
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

  /**
   * Everything a reply to this ticket starts from: who it goes to and from,
   * its subject and whether that can still be chosen, the greeting filled in
   * for this reader, and what the platform will add under it. Puts the site's
   * default templates and signature in place first.
   */
  routes.get("/tickets/:id/compose", async (c) => {
    const operator = client(c);
    if (operator instanceof Response) return operator;
    const templates = await templatesOf(operator);
    if (!templates) return unavailable(c);
    await ensureSignature(operator).catch(() => undefined);

    const ticket = await operator.getTicket(c.req.param("id"));
    if (!ticket.ok) return failure(c, ticket);
    const project = await operator.project();
    if (!project.ok) return failure(c, project);
    const carrier = templates.find((template) => template.key === SUBJECT_KEY);
    const opening = templates.find((template) => template.key === OPENING_KEY);

    const lane = laneOf(ticket.value.subject) ?? "general";
    let subject: string = DEFAULT_SUBJECT[lane];
    let subjectEditable = true;
    if (carrier && ticket.value.canReply) {
      const probed = await subjectOf(operator, ticket.value.id, carrier);
      if (!probed.ok) return failure(c, probed);
      subjectEditable = probed.value.editable;
      if (!subjectEditable) subject = probed.value.subject;
    }
    let greeting = "";
    if (opening?.isActive && ticket.value.canReply) {
      const applied = await operator.applyTemplate(ticket.value.id, opening.id);
      if (applied.ok) greeting = applied.value.body.trim();
    }

    return c.json({
      to: ticket.value.requesterEmail,
      from: REPLY_FROM,
      subject,
      subjectEditable,
      opening: greeting,
      closing: REPLY_CLOSING,
      signature: project.value.signature,
    } satisfies InquiryComposeDto);
  });

  /** A template filled in for this ticket: the reader's name, the site's name and URL. */
  routes.post("/tickets/:id/apply-template", async (c) => {
    const parsed = validate(applySchema, await c.req.json().catch(() => null));
    if (!parsed.ok)
      return errorResponse(c, parsed.code, "invalid request body", 400, parsed.issues);
    const operator = client(c);
    if (operator instanceof Response) return operator;
    const templates = await templatesOf(operator);
    if (!templates) return unavailable(c);
    const template = templates.find((entry) => entry.id === parsed.value.templateId);
    if (!template || !isPickable(template)) {
      return errorResponse(c, "API_NOT_FOUND", "no such template", 404);
    }
    const applied = await operator.applyTemplate(c.req.param("id"), template.id);
    if (!applied.ok) return failure(c, applied);
    // The platform answers with the template's subject only where one can still be chosen.
    const subject =
      template.subject && applied.value.subject === template.subject ? template.subject : null;
    return c.json({
      body: applied.value.body,
      subject,
      unresolved: unresolved(applied.value.body),
    } satisfies InquiryAppliedTemplateDto);
  });

  /**
   * Mails the person who wrote in. Answering is working on the ticket, so one
   * that is new or merely acknowledged is moved to 対応中 first, and one that
   * was resolved is reopened; afterwards it can go straight on to 返事待ち or
   * 解決済み. The subject is used only for a first reply to a form message.
   */
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
    const id = c.req.param("id");

    const found = await operator.getTicket(id);
    if (!found.ok) return failure(c, found);
    let ticket = found.value;
    // NEW → 確認済み → 対応中, at most two steps, each one the platform allows.
    for (let step = 0; step < 2 && ticket.status !== "IN_PROGRESS"; step += 1) {
      const next = (["IN_PROGRESS", "ACKNOWLEDGED"] as const).find((status) =>
        ticket.allowedStatuses.includes(status),
      );
      if (!next || !isOpen(ticket.status)) break;
      const moved = await operator.changeTicket(
        ticket.id,
        { revision: ticket.revision, status: next },
        who(c),
      );
      if (!moved.ok) return failure(c, moved);
      ticket = moved.value;
    }

    let templateId: string | undefined;
    const subject = parsed.value.subject?.trim();
    if (subject) {
      const templates = await templatesOf(operator);
      const carrier = templates?.find((template) => template.key === SUBJECT_KEY);
      if (!carrier) return unavailable(c);
      const probed = await subjectOf(operator, ticket.id, carrier);
      if (!probed.ok) return failure(c, probed);
      if (probed.value.editable) {
        if (carrier.subject !== subject) {
          const set = await operator.updateTemplate(carrier.id, { subject }, who(c));
          if (!set.ok) return failure(c, set);
        }
        templateId = carrier.id;
      }
    }

    const result = await operator.reply(
      ticket.id,
      {
        body: parsed.value.body,
        idempotencyKey: parsed.value.idempotencyKey,
        reopenIfResolved: !isOpen(ticket.status),
        ...(templateId ? { templateId } : {}),
      },
      who(c),
    );
    if (!result.ok) return failure(c, result);
    c.get("ctx").logger.info("inquiry.replied", { ticketId: result.value.id });

    const then = parsed.value.afterStatus;
    let status = result.value.status;
    if (then && result.value.allowedStatuses.includes(then)) {
      const moved = await operator.changeTicket(
        result.value.id,
        {
          revision: result.value.revision,
          status: then,
          ...(then === "RESOLVED" ? { resolution: "RESOLVED" as const } : {}),
        },
        who(c),
      );
      // The reply is out either way; a refused move only leaves it 対応中.
      if (moved.ok) status = moved.value.status;
    }
    return c.json({ ok: true, status });
  });

  return routes;
}
