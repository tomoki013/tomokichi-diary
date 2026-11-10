import type {
  InquiryAppliedTemplateDto,
  InquiryComposeDto,
  InquiryReplyTemplateDto,
  InquirySignatureDto,
  InquiryStatusDto,
  InquiryTicketDetailDto,
  InquiryTicketPageDto,
  InquiryTicketStatus,
} from "../dto.js";
import { v } from "../validation.js";
import { operation } from "./spec.js";

/**
 * The inbox is the one area the MCP servers never see, to read or to write:
 * it holds readers' addresses and sends mail in the owner's name.
 */
export const INQUIRY_STATUSES = [
  "NEW",
  "TRIAGE",
  "ACKNOWLEDGED",
  "IN_PROGRESS",
  "WAITING_CUSTOMER",
  "WAITING_INTERNAL",
  "RESOLVED",
  "CLOSED",
] as const satisfies readonly InquiryTicketStatus[];
export const INQUIRY_RESOLUTIONS = [
  "RESOLVED",
  "NO_ACTION_REQUIRED",
  "SPAM",
  "DUPLICATE",
  "INVALID",
  "USER_WITHDREW",
  "OTHER",
] as const;

const ticketId = v.string({ min: 1, max: 200 });
const target = { type: "inquiry", idField: "ticketId" } as const;
const template = {
  name: v.string({ min: 1, max: 160 }),
  subject: v.nullable(v.string({ max: 200 })),
  body: v.string({ min: 1, max: 20_000 }),
  isActive: v.optional(v.boolean(), true),
  sortOrder: v.optional(v.number({ min: 0, max: 9999, integer: true }), 100),
};
const adminOnly = { surface: "admin-only" } as const;

export const inquiryOperations = {
  "inquiry.status": operation<InquiryStatusDto>()({
    kind: "read",
    ...adminOnly,
    input: v.object({}),
    description: "問い合わせ基盤につながっているか、返信メールを送れるか。",
    target: { type: "inquiry" },
  }),
  "inquiry.signature": operation<InquirySignatureDto>()({
    kind: "read",
    ...adminOnly,
    input: v.object({}),
    description: "返信の下に付く署名。",
    target: { type: "inquiry" },
  }),
  "inquiry.saveSignature": operation<InquirySignatureDto>()({
    kind: "write",
    ...adminOnly,
    input: v.object({ signature: v.string({ max: 2000 }) }),
    description: "返信の署名を保存します。空にすると基盤の既定の署名に戻ります。",
    target: { type: "inquiry" },
  }),
  "inquiry.templates": operation<{ items: readonly InquiryReplyTemplateDto[] }>()({
    kind: "read",
    ...adminOnly,
    input: v.object({}),
    description: "返信テンプレートの一覧（停止中のものも含む）。",
    target: { type: "inquiry" },
  }),
  "inquiry.createTemplate": operation<InquiryReplyTemplateDto>()({
    kind: "write",
    ...adminOnly,
    input: v.object(template),
    description: "返信テンプレートを作ります。",
    target: { type: "inquiry" },
  }),
  "inquiry.updateTemplate": operation<InquiryReplyTemplateDto>()({
    kind: "write",
    ...adminOnly,
    input: v.object({ templateId: v.string({ min: 1, max: 200 }), ...template }),
    description: "返信テンプレートを更新します。",
    target: { type: "inquiry", idField: "templateId" },
  }),
  "inquiry.tickets": operation<InquiryTicketPageDto>()({
    kind: "read",
    ...adminOnly,
    input: v.object({
      status: v.optional(v.string({ max: 40 }), ""),
      lane: v.optional(v.string({ max: 40 }), ""),
      query: v.optional(v.string({ max: 200 }), ""),
      offset: v.optional(v.number({ integer: true, min: 0 }), 0),
    }),
    description: "問い合わせの一覧と件数。status は open・各状態・空（すべて）。",
    target: { type: "inquiry" },
  }),
  "inquiry.ticket": operation<InquiryTicketDetailDto>()({
    kind: "read",
    ...adminOnly,
    input: v.object({ ticketId, offset: v.optional(v.number({ integer: true, min: 0 }), 0) }),
    description: "問い合わせ1件と、そのやり取り。",
    target,
  }),
  "inquiry.changeTicket": operation<{ ok: true }>()({
    kind: "write",
    ...adminOnly,
    input: v.object({
      ticketId,
      revision: v.number({ min: 0, integer: true }),
      status: v.maybe(v.literalUnion(INQUIRY_STATUSES)),
      resolution: v.maybe(v.literalUnion(INQUIRY_RESOLUTIONS)),
      nextAction: v.maybe(v.nullable(v.string({ max: 4000 }))),
      nextActionAt: v.maybe(v.nullable(v.string({ min: 20, max: 40 }))),
    }),
    description: "問い合わせの状態・解決理由・次にやることを変えます（送った項目だけ）。",
    target,
  }),
  "inquiry.addNote": operation<{ ok: true }>()({
    kind: "write",
    ...adminOnly,
    input: v.object({
      ticketId,
      body: v.string({ min: 1, max: 100_000 }),
      idempotencyKey: v.string({ min: 8, max: 200 }),
    }),
    description: "問い合わせに内部メモを残します（相手には送られません）。",
    target,
  }),
  "inquiry.compose": operation<InquiryComposeDto>()({
    kind: "read",
    ...adminOnly,
    input: v.object({ ticketId }),
    description: "返信の書き出しに必要なもの: 宛先、差出人、件名、あいさつ文、結び、署名。",
    target,
  }),
  "inquiry.applyTemplate": operation<InquiryAppliedTemplateDto>()({
    kind: "read",
    ...adminOnly,
    input: v.object({ ticketId, templateId: v.string({ min: 1, max: 200 }) }),
    description: "テンプレートを、この問い合わせの相手の名前などで埋めて返します。",
    target,
  }),
  "inquiry.reply": operation<{ ok: true; status: InquiryTicketStatus }>()({
    kind: "write",
    ...adminOnly,
    input: v.object({
      ticketId,
      body: v.string({ min: 1, max: 100_000 }),
      idempotencyKey: v.string({ min: 8, max: 200 }),
      subject: v.nullable(v.string({ max: 200 })),
      afterStatus: v.nullable(v.literalUnion(["WAITING_CUSTOMER", "RESOLVED"] as const)),
      closing: v.optional(v.boolean(), true),
    }),
    description: "問い合わせの相手に返信メールを送ります。",
    target,
  }),
};
