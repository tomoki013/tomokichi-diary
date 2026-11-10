import { CONTACT_LANES, CONTACT_LANE_LABELS, findContactTopic } from "@tomokichi/domain";
import {
  INQUIRY_STATUSES,
  type InquiryCountsDto,
  type InquiryReplyTemplateDto,
  type InquirySignatureDto,
  type InquiryTicketDetailDto,
  type InquiryTicketStatus,
  type InquiryTicketSummaryDto,
} from "@tomokichi/contracts";
import type {
  IntakeResult,
  OperatorProject,
  OperatorReplyTemplate,
  OperatorTicketDetail,
  OperatorTicketSummary,
  ProjectOperatorClient,
} from "@inquiry-platform/sdk";
import {
  defaultSubject,
  ensureSignature,
  ensureTemplates,
  fillSiteVariables,
  isPickable,
  OPENING_KEY,
  REPLY_CLOSING,
  REPLY_FROM,
  SUBJECT_KEY,
  withClosing,
} from "../../inquiry-templates.js";
import { invalid, notFound, OpError, type Handlers, type OpScope } from "../scope.js";

/**
 * The admin's inbox for this site's contacts on the shared inquiry platform:
 * where they are listed, worked as tickets, annotated and answered. A reply is
 * mailed by the platform, which decides the recipient and sender from the
 * ticket; the body and, for a first reply, the subject go up from here.
 *
 * Every operation here is `admin-only`: no MCP server can read or send. The
 * platform's `ProjectOperator` binding scopes each call to this site's
 * project, applies the ticket rules, and audits each change as this API and
 * the person who passed the gate.
 */
type Names =
  | "inquiry.status"
  | "inquiry.signature"
  | "inquiry.saveSignature"
  | "inquiry.templates"
  | "inquiry.createTemplate"
  | "inquiry.updateTemplate"
  | "inquiry.tickets"
  | "inquiry.ticket"
  | "inquiry.changeTicket"
  | "inquiry.addNote"
  | "inquiry.compose"
  | "inquiry.applyTemplate"
  | "inquiry.reply";

const PAGE_SIZE = 50;
/** The platform pages by at most 100; a personal blog's inbox fits well under the cap. */
const SCAN_PAGE = 100;
const SCAN_CAP = 2000;

const isOpen = (status: InquiryTicketStatus): boolean =>
  status !== "RESOLVED" && status !== "CLOSED";

/** `{{name}}` left in a reply: the platform refuses to send one. */
const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;
const unresolved = (text: string): string[] => [
  ...new Set([...text.matchAll(PLACEHOLDER)].map((match) => match[1] ?? "")),
];

type Failure = Extract<IntakeResult<unknown>, { ok: false }>;

function failure({ ctx }: OpScope, result: Failure): OpError {
  const { code, message } = result.error;
  switch (code) {
    case "NOT_FOUND":
      return notFound("API_NOT_FOUND", "no such inquiry");
    case "CONFLICT":
    case "INVALID_STATUS_TRANSITION":
      return new OpError("API_CONFLICT", message, 409);
    case "VALIDATION_ERROR":
      return invalid(message);
    case "MAIL_ERROR":
      ctx.logger.error("inquiry.mail_failed", { code: "INQUIRY_MAIL_FAILED" });
      return new OpError("INQUIRY_MAIL_FAILED", "the reply could not be mailed", 502);
    case "UNAVAILABLE":
    case "FORBIDDEN":
      // The binding is missing or not granted this project: configuration,
      // not something the operator did.
      ctx.logger.error("inquiry.not_configured", { code: "API_INTERNAL" });
      return new OpError("API_INTERNAL", "the inquiry platform is not configured", 503);
    default:
      ctx.logger.error("inquiry.upstream_failed", { code: "API_INTERNAL" });
      return new OpError("API_INTERNAL", "the inquiry platform is unavailable", 502);
  }
}

/** The platform's answer, or its failure as the API's error. */
function take<T>(scope: OpScope, result: IntakeResult<T>): T {
  if (!result.ok) throw failure(scope, result);
  return result.value;
}

function client(scope: OpScope): ProjectOperatorClient {
  const operator = scope.inquiry();
  if (!operator) throw new OpError("API_INTERNAL", "the inquiry platform is not configured", 503);
  return operator;
}

/** This site's templates with the defaults in place. */
async function templatesOf(scope: OpScope, operator: ProjectOperatorClient) {
  const templates = await ensureTemplates(operator).catch(() => null);
  if (!templates) {
    scope.ctx.logger.error("inquiry.upstream_failed", { code: "API_INTERNAL" });
    throw new OpError("API_INTERNAL", "the inquiry platform is unavailable", 502);
  }
  return templates;
}

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
const who = (scope: OpScope) => ({ id: scope.actor ?? "admin" });

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
  return { all: tickets.length, open, new: byStatus.NEW ?? 0, overdue, openByLane, byStatus };
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

export const inquiryHandlers: Handlers<Names> = {
  "inquiry.status": async (scope) => {
    const operator = scope.inquiry();
    if (!operator)
      return { configured: false, registered: false, mailConfigured: false, lanes: LANES };
    const project = await operator.project();
    if (!project.ok && project.error.code !== "NOT_FOUND") throw failure(scope, project);
    return {
      configured: true,
      registered: project.ok,
      mailConfigured: project.ok && project.value.mailConfigured,
      lanes: LANES,
    };
  },

  /*
   * The signature under this site's replies. Without one of its own the
   * platform signs with the deployment's, which is why the admin shows it.
   */
  "inquiry.signature": async (scope) => toSignature(take(scope, await client(scope).project())),

  "inquiry.saveSignature": async (scope, { signature }) =>
    toSignature(take(scope, await client(scope).setSignature(signature.trim(), who(scope)))),

  /** This site's own templates, retired ones included so they can be brought back. */
  "inquiry.templates": async (scope) => ({
    items: (await templatesOf(scope, client(scope)))
      .filter((template) => template.key !== SUBJECT_KEY)
      .map(toTemplate)
      .toSorted((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ja")),
  }),

  "inquiry.createTemplate": async (scope, input) =>
    toTemplate(
      take(
        scope,
        await client(scope).createTemplate(
          {
            // The platform's stable handle; nothing here refers to it.
            key: `diary_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`,
            name: input.name.trim(),
            subject: input.subject?.trim() || null,
            body: input.body,
            isActive: input.isActive,
            sortOrder: input.sortOrder,
          },
          who(scope),
        ),
      ),
    ),

  "inquiry.updateTemplate": async (scope, { templateId, ...input }) =>
    toTemplate(
      take(
        scope,
        await client(scope).updateTemplate(
          templateId,
          {
            name: input.name.trim(),
            subject: input.subject?.trim() || null,
            body: input.body,
            isActive: input.isActive,
            sortOrder: input.sortOrder,
          },
          who(scope),
        ),
      ),
    ),

  /*
   * The whole inbox: every ticket, counted, then narrowed by status (`open`,
   * one status, or all when empty) and lane. Read in full so the counts and
   * the lane filter are exact; the platform cannot filter by lane.
   */
  "inquiry.tickets": async (scope, { status, lane, query, offset }) => {
    const all = take(scope, await everything(client(scope), query.trim() || undefined));
    const matching = all
      .filter((ticket) =>
        status === "open"
          ? isOpen(ticket.status)
          : (INQUIRY_STATUSES as readonly string[]).includes(status)
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
    return {
      items,
      total: matching.length,
      offset,
      limit: PAGE_SIZE,
      hasMore: offset + items.length < matching.length,
      counts: countAll(all),
    };
  },

  /** `ticketId` is a ticket id or its number, as a notification link carries. */
  "inquiry.ticket": async (scope, { ticketId, offset }) =>
    toDetail(take(scope, await client(scope).getTicket(ticketId, offset))),

  // Only what was sent: a status change must not clear the next action.
  "inquiry.changeTicket": async (scope, { ticketId, revision, ...change }) => {
    take(
      scope,
      await client(scope).changeTicket(
        ticketId,
        {
          revision,
          ...(change.status !== undefined ? { status: change.status } : {}),
          ...(change.resolution !== undefined ? { resolution: change.resolution } : {}),
          ...(change.nextAction !== undefined ? { nextAction: change.nextAction } : {}),
          ...(change.nextActionAt !== undefined ? { nextActionAt: change.nextActionAt } : {}),
        },
        who(scope),
      ),
    );
    return { ok: true };
  },

  "inquiry.addNote": async (scope, { ticketId, ...note }) => {
    take(scope, await client(scope).addNote(ticketId, note, who(scope)));
    return { ok: true };
  },

  /*
   * Everything a reply to this ticket starts from: who it goes to and from,
   * its subject and whether that can still be chosen, the greeting filled in
   * for this reader, and what the platform will add under it. Puts the site's
   * default templates and signature in place first.
   */
  "inquiry.compose": async (scope, { ticketId }) => {
    const operator = client(scope);
    const templates = await templatesOf(scope, operator);
    await ensureSignature(operator).catch(() => undefined);
    const ticket = take(scope, await operator.getTicket(ticketId));
    const project = take(scope, await operator.project());
    const carrier = templates.find((template) => template.key === SUBJECT_KEY);
    const opening = templates.find((template) => template.key === OPENING_KEY);

    let subject = defaultSubject(findContactTopic(ticket.subject));
    let subjectEditable = true;
    if (carrier && ticket.canReply) {
      const probed = take(scope, await subjectOf(operator, ticket.id, carrier));
      subjectEditable = probed.editable;
      if (!subjectEditable) subject = probed.subject;
    }
    let greeting = "";
    if (opening?.isActive && ticket.canReply) {
      const applied = await operator.applyTemplate(ticket.id, opening.id);
      if (applied.ok) greeting = fillSiteVariables(applied.value.body).trim();
    }
    return {
      to: ticket.requesterEmail,
      from: REPLY_FROM,
      subject,
      subjectEditable,
      opening: greeting.replaceAll("{{operatorName}}", "ともきち"),
      openings: {
        takagi: greeting.replaceAll("{{operatorName}}", "髙木"),
        tomokichi: greeting.replaceAll("{{operatorName}}", "ともきち"),
      },
      closing: REPLY_CLOSING,
      signature: project.signature,
    };
  },

  /** A template filled in for this ticket: the reader's name, the site's name and URL. */
  "inquiry.applyTemplate": async (scope, { ticketId, templateId }) => {
    const operator = client(scope);
    const template = (await templatesOf(scope, operator)).find((entry) => entry.id === templateId);
    if (!template || !isPickable(template)) throw notFound("API_NOT_FOUND", "no such template");
    const applied = take(scope, await operator.applyTemplate(ticketId, template.id));
    // The platform answers with the template's subject only where one can still be chosen.
    const subject =
      template.subject && applied.subject === template.subject
        ? fillSiteVariables(template.subject)
        : null;
    const body = fillSiteVariables(applied.body);
    return { body, subject, unresolved: unresolved(body) };
  },

  /*
   * Mails the person who wrote in. Answering is working on the ticket, so one
   * that is new or merely acknowledged is moved to 対応中 first, and one that
   * was resolved is reopened; afterwards it can go straight on to 返事待ち or
   * 解決済み. The subject is used only for a first reply to a form message.
   */
  "inquiry.reply": async (scope, input) => {
    const body = fillSiteVariables(input.body);
    const subject = input.subject ? fillSiteVariables(input.subject).trim() : "";
    // The platform refuses these too; saying which ones is what helps.
    const left = unresolved(`${subject}\n${body}`);
    if (left.length > 0)
      throw invalid(
        `置き換えていない項目が残っています: ${left.map((name) => `{{${name}}}`).join(", ")}`,
      );
    const operator = client(scope);
    let ticket = take(scope, await operator.getTicket(input.ticketId));
    // NEW → 確認済み → 対応中, at most two steps, each one the platform allows.
    for (let step = 0; step < 2 && ticket.status !== "IN_PROGRESS"; step += 1) {
      const next = (["IN_PROGRESS", "ACKNOWLEDGED"] as const).find((status) =>
        ticket.allowedStatuses.includes(status),
      );
      if (!next || !isOpen(ticket.status)) break;
      ticket = take(
        scope,
        await operator.changeTicket(
          ticket.id,
          { revision: ticket.revision, status: next },
          who(scope),
        ),
      );
    }

    let templateId: string | undefined;
    if (subject) {
      const carrier = (await templatesOf(scope, operator)).find(
        (template) => template.key === SUBJECT_KEY,
      );
      if (!carrier) throw new OpError("API_INTERNAL", "the inquiry platform is unavailable", 502);
      const probed = take(scope, await subjectOf(operator, ticket.id, carrier));
      if (probed.editable) {
        if (carrier.subject !== subject)
          take(scope, await operator.updateTemplate(carrier.id, { subject }, who(scope)));
        templateId = carrier.id;
      }
    }

    const sent = take(
      scope,
      await operator.reply(
        ticket.id,
        {
          body: input.closing ? withClosing(body) : body,
          idempotencyKey: input.idempotencyKey,
          reopenIfResolved: !isOpen(ticket.status),
          ...(templateId ? { templateId } : {}),
        },
        who(scope),
      ),
    );
    scope.ctx.logger.info("inquiry.replied", { ticketId: sent.id });

    let status = sent.status;
    const then = input.afterStatus;
    if (then && sent.allowedStatuses.includes(then)) {
      const moved = await operator.changeTicket(
        sent.id,
        {
          revision: sent.revision,
          status: then,
          ...(then === "RESOLVED" ? { resolution: "RESOLVED" as const } : {}),
        },
        who(scope),
      );
      // The reply is out either way; a refused move only leaves it 対応中.
      if (moved.ok) status = moved.value.status;
    }
    return { ok: true, status };
  },
};
