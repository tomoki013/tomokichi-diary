import { beforeEach, describe, expect, it } from "vitest";
import { createTestContext } from "@tomokichi/infra-d1/testing-context";
import type { AppContext } from "@tomokichi/application";
import {
  createProjectOperatorClient,
  type OperatorReplyTemplate,
  type OperatorTicketDetail,
  type ProjectOperatorApi,
} from "@inquiry-platform/sdk";
import { readFileSync } from "node:fs";
import { createApp } from "../app.js";
import type { Env } from "../env.js";
import { INQUIRY_PROJECT_SLUG } from "../inquiry.js";
import { DEFAULT_TEMPLATES, OPENING_KEY, SUBJECT_KEY } from "../inquiry-templates.js";

/*
 * The admin's inquiry screen works this site's tickets through the platform's
 * `ProjectOperator` binding. The platform owns scope and rules; what matters
 * here is that this API only ever names its own project, sends the fields it
 * means to, tells the platform who acted, and turns the platform's answers
 * into this API's errors without passing their details through.
 */

const TOKEN = "test-admin-token";
const auth = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
const env = { ADMIN_TOKEN: TOKEN } as unknown as Env;

interface Call {
  method: string;
  args: unknown[];
}

let ctx: AppContext;
let calls: Call[];
/** A fixed answer, or one worked out from the call's arguments. */
let answer: Partial<Record<keyof ProjectOperatorApi, unknown>>;
let templates: OperatorReplyTemplate[];

function ticket(overrides: Partial<OperatorTicketDetail> = {}): OperatorTicketDetail {
  return {
    id: "t1",
    number: "TK-000001",
    status: "NEW",
    type: "contact",
    source: "web_form",
    assignee: null,
    receiptId: "receipt-1",
    resolution: null,
    priority: "P3",
    subject: "記事について",
    requesterEmail: "reader@example.com",
    slaState: "OK",
    nextAction: "返信する",
    nextActionAt: null,
    createdAt: "2026-09-27T00:00:00.000Z",
    updatedAt: "2026-09-27T00:00:00.000Z",
    revision: 3,
    acknowledgedAt: null,
    resolvedAt: null,
    closedAt: null,
    allowedStatuses: ["TRIAGE", "ACKNOWLEDGED", "RESOLVED"],
    canReply: true,
    timeline: [
      {
        kind: "message",
        id: "m1",
        direction: "inbound",
        sender: "reader@example.com",
        body: "バスの時刻を教えてください",
        createdAt: "2026-09-27T00:00:00.000Z",
      },
    ],
    totalTimeline: 1,
    ...overrides,
  };
}

const project = { id: "app-diary", slug: "tomokichi-diary", name: "ともきちの旅行日記" };
const LANES = [
  { key: "general", label: "一般" },
  { key: "media", label: "メディア・お仕事" },
];

function template(overrides: Partial<OperatorReplyTemplate> = {}): OperatorReplyTemplate {
  return {
    id: "tpl1",
    key: "diary_abc",
    name: "お礼",
    subject: null,
    body: "{{userName}} 様\n\nご連絡ありがとうございます。",
    isActive: true,
    sortOrder: 100,
    updatedAt: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

/** The site's defaults as the platform would hold them once created. */
function seeded(): OperatorReplyTemplate[] {
  return [
    ...DEFAULT_TEMPLATES.map((entry, index) =>
      template({ ...entry, id: `tpl-${entry.key}`, sortOrder: entry.sortOrder + index * 0 }),
    ),
    template({
      id: "tpl-carrier",
      key: SUBJECT_KEY,
      name: "（システム）返信の件名",
      subject: "【ともきちの旅行日記】お問い合わせいただいた件について",
      isActive: false,
    }),
  ];
}

/**
 * What the platform does for these calls when a test sets nothing: tickets
 * move where they are told, a template applied to a form message keeps its
 * own subject, and a reply returns the ticket.
 */
function platformDefault(method: string, args: unknown[]): unknown {
  switch (method) {
    case "project":
    case "setSignature":
      return { ...project, mailConfigured: true, signature: "" };
    case "listTickets":
      return { items: [ticket()], total: 1 };
    case "listTemplates":
      return templates;
    case "applyTemplate": {
      const found = templates.find((entry) => entry.id === args[2]);
      return {
        body: found?.body.replace("{{userName}}", "ともきち") ?? "",
        unresolved: [],
        subject: found?.subject ?? "お問い合わせいただいた件について",
      };
    }
    case "createTemplate":
      return template(args[1] as Partial<OperatorReplyTemplate>);
    case "updateTemplate":
      return template({ id: String(args[1]), ...(args[2] as Partial<OperatorReplyTemplate>) });
    case "changeTicket": {
      const change = args[2] as { revision: number; status?: OperatorTicketDetail["status"] };
      const next = change.status ?? "NEW";
      return ticket({
        status: next,
        revision: change.revision + 1,
        allowedStatuses:
          next === "ACKNOWLEDGED"
            ? ["IN_PROGRESS", "RESOLVED"]
            : next === "IN_PROGRESS"
              ? ["WAITING_CUSTOMER", "RESOLVED"]
              : [],
      });
    }
    case "reply":
      return ticket({
        status: "IN_PROGRESS",
        revision: 9,
        allowedStatuses: ["WAITING_CUSTOMER", "RESOLVED"],
      });
    default:
      return ticket();
  }
}

/** A stand-in platform: records what it was asked, answers what the test set. */
const platform = new Proxy({} as ProjectOperatorApi, {
  get:
    (_target, method: string) =>
    async (...args: unknown[]) => {
      calls.push({ method, args });
      const set = answer[method as keyof ProjectOperatorApi];
      if (typeof set === "function") return (set as (...a: unknown[]) => unknown)(...args);
      return set ?? { ok: true, value: platformDefault(method, args) };
    },
});

function app(bound = true) {
  return createApp({
    contextFactory: () => ctx,
    inquiryOperator: () =>
      bound ? createProjectOperatorClient(platform, INQUIRY_PROJECT_SLUG) : null,
  });
}

function request(path: string, init: RequestInit = {}, bound = true) {
  return app(bound).request(`/v1/admin/inquiry${path}`, { headers: auth, ...init }, env);
}

const last = (method: string) => calls.findLast((call) => call.method === method);

beforeEach(async () => {
  ctx = await createTestContext();
  calls = [];
  answer = {};
  templates = seeded();
});

const calledWith = (method: string) => calls.filter((call) => call.method === method);

describe("/v1/admin/inquiry", () => {
  it("sits behind the admin gate", async () => {
    const response = await app().request("/v1/admin/inquiry/tickets", {}, env);
    expect(response.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("reports an unbound platform instead of calling anything", async () => {
    expect(await (await request("/status", {}, false)).json()).toEqual({
      configured: false,
      registered: false,
      mailConfigured: false,
      lanes: LANES,
    });
    expect((await request("/tickets", {}, false)).status).toBe(503);
  });

  it("reports an unregistered project", async () => {
    answer.project = { ok: false, error: { code: "NOT_FOUND", message: "x" } };
    expect(await (await request("/status")).json()).toEqual({
      configured: true,
      registered: false,
      mailConfigured: false,
      lanes: LANES,
    });
  });

  it("names only this site's project, whatever the request says", async () => {
    await request("/tickets?status=open&query=%E3%83%90%E3%82%B9&project=remeet");
    expect(last("listTickets")?.args).toEqual([
      "tomokichi-diary",
      { query: "バス", limit: 100, offset: 0 },
    ]);
    expect(calls.every((call) => call.args[0] === "tomokichi-diary")).toBe(true);
  });

  it("reads the whole inbox in the platform's largest pages", async () => {
    const many = (from: number, count: number) =>
      Array.from({ length: count }, (_, index) =>
        ticket({
          id: `t${from + index}`,
          createdAt: `2026-10-01T00:00:${String(index % 60).padStart(2, "0")}.000Z`,
        }),
      );
    answer.listTickets = (_slug: string, query: { offset: number }) => ({
      ok: true,
      value: { items: query.offset === 0 ? many(0, 100) : many(100, 20), total: 120 },
    });
    const body = await (await request("/tickets")).json();
    expect(
      calledWith("listTickets").map((call) => (call.args[1] as { offset: number }).offset),
    ).toEqual([0, 100]);
    expect(body).toMatchObject({ total: 120, offset: 0, limit: 50, hasMore: true });
    expect(body.items).toHaveLength(50);
  });

  it("counts every ticket, then narrows by status and lane, open and newest first", async () => {
    answer.listTickets = {
      ok: true,
      value: {
        items: [
          ticket({ id: "old-done", status: "CLOSED", createdAt: "2026-10-03T00:00:00.000Z" }),
          ticket({
            id: "media-new",
            subject: "お仕事・取材の相談",
            createdAt: "2026-10-02T00:00:00.000Z",
          }),
          ticket({
            id: "general-late",
            status: "IN_PROGRESS",
            slaState: "BREACHED",
            createdAt: "2026-10-01T00:00:00.000Z",
          }),
        ],
        total: 3,
      },
    };
    const all = await (await request("/tickets")).json();
    expect(all.items.map((item: { id: string }) => item.id)).toEqual([
      "media-new",
      "general-late",
      "old-done",
    ]);
    expect(all.counts).toEqual({
      all: 3,
      open: 2,
      new: 1,
      overdue: 1,
      openByLane: { general: 1, media: 1 },
      byStatus: { CLOSED: 1, NEW: 1, IN_PROGRESS: 1 },
    });

    const media = await (await request("/tickets?status=open&lane=media")).json();
    expect(media.items.map((item: { id: string }) => item.id)).toEqual(["media-new"]);
    expect(media.counts.all).toBe(3);

    const closed = await (await request("/tickets?status=CLOSED")).json();
    expect(closed.items.map((item: { id: string }) => item.id)).toEqual(["old-done"]);
  });

  it("ignores a status or lane filter it does not know", async () => {
    const body = await (await request("/tickets?status=DROP%20TABLE&lane=x")).json();
    expect(last("listTickets")?.args[1]).toEqual({ limit: 100, offset: 0 });
    expect(body.total).toBe(1);
  });

  it("opens a ticket by number, as a notification link carries it", async () => {
    const body = await (await request("/tickets/TK-000001")).json();
    expect(last("getTicket")?.args).toEqual(["tomokichi-diary", "TK-000001", 0]);
    expect(body).toMatchObject({
      id: "t1",
      revision: 3,
      canReply: true,
      receiptId: "receipt-1",
      lane: "general",
    });
  });

  it("names the lane a ticket's topic belongs to, and none for other subjects", async () => {
    answer.listTickets = {
      ok: true,
      value: {
        items: [
          ticket({ id: "a", subject: "お仕事・取材の相談" }),
          ticket({ id: "b", subject: "Re: 先日の件" }),
        ],
        total: 2,
      },
    };
    const body = await (await request("/tickets")).json();
    expect(body.items.map((item: { lane: string | null }) => item.lane)).toEqual(["media", null]);
  });

  it("answers 404 when the platform says the ticket is not this site's", async () => {
    answer.getTicket = { ok: false, error: { code: "NOT_FOUND", message: "secret detail" } };
    const response = await request("/tickets/other");
    expect(response.status).toBe(404);
    expect(JSON.stringify(await response.json())).not.toContain("secret detail");
  });

  it("passes exactly the fields that were sent, and says who acted", async () => {
    const response = await request("/tickets/t1", {
      method: "PATCH",
      body: JSON.stringify({ revision: 3, status: "ACKNOWLEDGED" }),
    });
    expect(response.status).toBe(200);
    expect(last("changeTicket")?.args).toEqual([
      "tomokichi-diary",
      "t1",
      { revision: 3, status: "ACKNOWLEDGED" },
      { id: "admin-token" },
    ]);

    // An explicit null clears; it is not dropped like an absent field.
    await request("/tickets/t1", {
      method: "PATCH",
      body: JSON.stringify({ revision: 3, nextAction: null, nextActionAt: null }),
    });
    expect(last("changeTicket")?.args[2]).toEqual({
      revision: 3,
      nextAction: null,
      nextActionAt: null,
    });
  });

  it("rejects a change it does not recognise before calling the platform", async () => {
    const response = await request("/tickets/t1", {
      method: "PATCH",
      body: JSON.stringify({ revision: 3, status: "DELETED" }),
    });
    expect(response.status).toBe(400);
    expect(last("changeTicket")).toBeUndefined();
  });

  it("passes a stale revision back as a conflict", async () => {
    answer.changeTicket = {
      ok: false,
      error: { code: "CONFLICT", message: "ほかの操作で更新されています" },
    };
    const response = await request("/tickets/t1", {
      method: "PATCH",
      body: JSON.stringify({ revision: 1, status: "ACKNOWLEDGED" }),
    });
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("API_CONFLICT");
  });

  it("takes a new ticket on before replying, then moves it where it was asked", async () => {
    const response = await request("/tickets/t1/reply", {
      method: "POST",
      body: JSON.stringify({
        body: "お返事です",
        idempotencyKey: "reply-key-1",
        subject: null,
        afterStatus: "WAITING_CUSTOMER",
        to: "someone@example.com",
      }),
    });
    expect(await response.json()).toEqual({ ok: true, status: "WAITING_CUSTOMER" });
    expect(calledWith("changeTicket").map((call) => call.args[2])).toEqual([
      { revision: 3, status: "ACKNOWLEDGED" },
      { revision: 4, status: "IN_PROGRESS" },
      { revision: 9, status: "WAITING_CUSTOMER" },
    ]);
    // Recipient and sender are the platform's; nothing else goes up.
    expect(last("reply")?.args).toEqual([
      "tomokichi-diary",
      "t1",
      {
        body: "お返事です\n\n以上、よろしくお願いいたします。",
        idempotencyKey: "reply-key-1",
        reopenIfResolved: false,
      },
      { id: "admin-token" },
    ]);
  });

  it("leaves the closing off when asked, and never adds it twice", async () => {
    await request("/tickets/t1/reply", {
      method: "POST",
      body: JSON.stringify({ body: "お返事です", idempotencyKey: "reply-key-5", closing: false }),
    });
    expect((last("reply")!.args[2] as { body: string }).body).toBe("お返事です");
    await request("/tickets/t1/reply", {
      method: "POST",
      body: JSON.stringify({
        body: "お返事です\n\n以上、よろしくお願いいたします。\n",
        idempotencyKey: "reply-key-6",
      }),
    });
    expect((last("reply")!.args[2] as { body: string }).body).toBe(
      "お返事です\n\n以上、よろしくお願いいたします。",
    );
  });

  it("resolves with a result when asked to, and reopens a resolved ticket to reply", async () => {
    answer.getTicket = {
      ok: true,
      value: ticket({ status: "RESOLVED", allowedStatuses: ["IN_PROGRESS", "CLOSED"] }),
    };
    await request("/tickets/t1/reply", {
      method: "POST",
      body: JSON.stringify({
        body: "追記です",
        idempotencyKey: "reply-key-2",
        afterStatus: "RESOLVED",
      }),
    });
    expect((last("reply")!.args[2] as { reopenIfResolved: boolean }).reopenIfResolved).toBe(true);
    expect(last("changeTicket")?.args[2]).toEqual({
      revision: 9,
      status: "RESOLVED",
      resolution: "RESOLVED",
    });
  });

  it("sends a first reply under the subject typed in, through the subject carrier", async () => {
    await request("/tickets/t1/reply", {
      method: "POST",
      body: JSON.stringify({
        body: "お返事です",
        idempotencyKey: "reply-key-3",
        subject: " 【{{appName}}】写真のご利用について ",
      }),
    });
    expect(last("updateTemplate")?.args.slice(1, 3)).toEqual([
      "tpl-carrier",
      { subject: "【ともきちの旅行日記】写真のご利用について" },
    ]);
    expect(last("reply")?.args[2]).toMatchObject({ templateId: "tpl-carrier" });
  });

  it("leaves the subject alone once the conversation has one", async () => {
    answer.applyTemplate = {
      ok: true,
      value: { body: "", unresolved: [], subject: "Re: 写真の件" },
    };
    await request("/tickets/t1/reply", {
      method: "POST",
      body: JSON.stringify({
        body: "続きです",
        idempotencyKey: "reply-key-4",
        subject: "別の件名",
      }),
    });
    expect(last("updateTemplate")).toBeUndefined();
    expect(last("reply")?.args[2]).not.toHaveProperty("templateId");
  });

  it("lays out a reply: greeting, subject, closing and signature", async () => {
    const body = await (await request("/tickets/t1/compose")).json();
    expect(body).toEqual({
      to: "reader@example.com",
      from: "ともきちの旅行日記 <contact@tomokichidiary.com>",
      subject: "【ともきちの旅行日記】記事についてのお問い合わせ",
      subjectEditable: true,
      opening: expect.stringContaining("ともきち 様"),
      openings: {
        takagi: expect.stringContaining("ともきちの旅行日記を運営しております、髙木です。"),
        tomokichi: expect.stringContaining("ともきちの旅行日記を運営しております、ともきちです。"),
      },
      closing: "以上、よろしくお願いいたします。",
      signature: "",
    });
    // A site still signing as the deployment gets its own signature.
    expect(last("setSignature")?.args[1]).toContain("ともきちの旅行日記");

    answer.applyTemplate = {
      ok: true,
      value: { body: "", unresolved: [], subject: "Re: 写真の件" },
    };
    const later = await (await request("/tickets/t1/compose")).json();
    expect(later).toMatchObject({ subject: "Re: 写真の件", subjectEditable: false });
  });

  it("starts the subject from the topic the reader picked, or else the lane", async () => {
    const subjectFor = async (subject: string) => {
      answer.getTicket = { ok: true, value: ticket({ subject }) };
      return (await (await request("/tickets/t1/compose")).json()).subject;
    };
    expect(await subjectFor("お仕事・取材の相談")).toBe(
      "【ともきちの旅行日記】お仕事のご相談について",
    );
    expect(await subjectFor("旅先・記事のリクエスト")).toBe(
      "【ともきちの旅行日記】いただいたリクエストについて",
    );
    expect(await subjectFor("メールでの件名")).toBe(
      "【ともきちの旅行日記】お問い合わせいただいた件について",
    );
  });

  it("creates the default templates and the subject carrier when they are missing", async () => {
    templates = [];
    answer.listTemplates = () => {
      const listed = { ok: true, value: templates };
      templates = seeded();
      return listed;
    };
    await request("/templates");
    const created = calledWith("createTemplate").map(
      (call) => (call.args[1] as { key: string }).key,
    );
    expect(created).toEqual([...DEFAULT_TEMPLATES.map((entry) => entry.key), SUBJECT_KEY]);
  });

  it("moves an untouched first default to the current one, and keeps an edited one", async () => {
    const opening = DEFAULT_TEMPLATES.find((entry) => entry.key === OPENING_KEY)!;
    const thanks = DEFAULT_TEMPLATES.find((entry) => entry.key === "diary_thanks_feedback")!;
    templates = seeded().map((entry) =>
      entry.key === OPENING_KEY
        ? {
            ...entry,
            body: "{{userName}} 様\n\n旅行ブログ「ともきちの旅行日記」を運営しております、ともきちです。",
          }
        : entry.key === thanks.key
          ? { ...entry, body: "自分で書き直したお礼" }
          : entry,
    );
    await request("/templates");
    const updated = calledWith("updateTemplate").map((call) => call.args.slice(1, 3));
    expect(updated).toEqual([
      [`tpl-${OPENING_KEY}`, { name: opening.name, subject: opening.subject, body: opening.body }],
    ]);
  });

  it("refuses a reply that still has a placeholder, naming it", async () => {
    const response = await request("/tickets/t1/reply", {
      method: "POST",
      body: JSON.stringify({ body: "{{userName}} 様 {{ 日付 }}", idempotencyKey: "reply-key-3" }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toContain("{{日付}}");
    expect(last("reply")).toBeUndefined();
  });

  it("fills the site's own placeholders, and refuses one left in the subject", async () => {
    const refused = await request("/tickets/t1/reply", {
      method: "POST",
      body: JSON.stringify({
        body: "{{appName}}の記事です: {{siteUrl}}",
        idempotencyKey: "reply-key-7",
        subject: "{{articleTitle}}について",
      }),
    });
    expect(refused.status).toBe(400);
    expect((await refused.json()).error.message).toContain("{{articleTitle}}");

    await request("/tickets/t1/reply", {
      method: "POST",
      body: JSON.stringify({
        body: "{{appName}}の記事です: {{siteUrl}}",
        idempotencyKey: "reply-key-8",
        closing: false,
      }),
    });
    expect((last("reply")!.args[2] as { body: string }).body).toBe(
      "ともきちの旅行日記の記事です: https://tomokichidiary.com",
    );
  });

  it("says plainly when the platform could not mail the reply", async () => {
    answer.reply = { ok: false, error: { code: "MAIL_ERROR", message: "resend 500" } };
    const response = await request("/tickets/t1/reply", {
      method: "POST",
      body: JSON.stringify({ body: "お返事です", idempotencyKey: "reply-key-4" }),
    });
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error.code).toBe("INQUIRY_MAIL_FAILED");
    expect(JSON.stringify(body)).not.toContain("resend 500");
  });

  it("reads and sets the reply signature", async () => {
    expect(await (await request("/signature")).json()).toEqual({
      signature: "",
      usesDefault: true,
    });
    await request("/signature", {
      method: "PUT",
      body: JSON.stringify({ signature: "  ともきちの旅行日記\n  " }),
    });
    expect(last("setSignature")?.args).toEqual([
      "tomokichi-diary",
      "ともきちの旅行日記",
      { id: "admin-token" },
    ]);
  });

  it("lists this site's templates, retired ones too, without the subject carrier", async () => {
    const body = await (await request("/templates")).json();
    expect(last("listTemplates")?.args).toEqual(["tomokichi-diary", { includeInactive: true }]);
    const ids = body.items.map((item: { id: string }) => item.id);
    expect(ids).not.toContain("tpl-carrier");
    expect(ids).toHaveLength(DEFAULT_TEMPLATES.length);
    expect(body.items[0]).toMatchObject({ id: `tpl-${OPENING_KEY}`, role: "opening" });
    expect(body.items[1]).toMatchObject({ role: "reply" });
    expect(body.items[0]).not.toHaveProperty("key");
  });

  it("creates and edits a template, choosing the platform's key itself", async () => {
    answer.createTemplate = { ok: true, value: template() };
    answer.updateTemplate = { ok: true, value: template() };
    const input = { name: " お礼 ", subject: " ", body: "本文", isActive: true, sortOrder: 10 };

    expect(
      (await request("/templates", { method: "POST", body: JSON.stringify(input) })).status,
    ).toBe(201);
    const [, created] = last("createTemplate")!.args as [string, Record<string, unknown>];
    expect(created).toMatchObject({ name: "お礼", subject: null, body: "本文", sortOrder: 10 });
    expect(created.key).toMatch(/^diary_[0-9a-f]{12}$/);

    await request("/templates/tpl1", { method: "PATCH", body: JSON.stringify(input) });
    expect(last("updateTemplate")?.args.slice(1, 3)).toEqual([
      "tpl1",
      { name: "お礼", subject: null, body: "本文", isActive: true, sortOrder: 10 },
    ]);
  });

  it("fills a template for a ticket with its subject, and lists what is left to fill", async () => {
    templates.push(
      template({
        id: "tpl-x",
        key: "diary_x",
        subject: "【件名】",
        body: "{{userName}} 様 {{日付}}",
      }),
    );
    const body = await (
      await request("/tickets/t1/apply-template", {
        method: "POST",
        body: JSON.stringify({ templateId: "tpl-x" }),
      })
    ).json();
    expect(last("applyTemplate")?.args).toEqual(["tomokichi-diary", "t1", "tpl-x"]);
    expect(body).toEqual({
      body: "ともきち 様 {{日付}}",
      subject: "【件名】",
      unresolved: ["日付"],
    });
  });

  it("will not apply the subject carrier or the opening as a template", async () => {
    for (const id of ["tpl-carrier", `tpl-${OPENING_KEY}`]) {
      const response = await request("/tickets/t1/apply-template", {
        method: "POST",
        body: JSON.stringify({ templateId: id }),
      });
      expect(response.status).toBe(404);
    }
  });

  it("adds an internal note with its idempotency key", async () => {
    await request("/tickets/t1/notes", {
      method: "POST",
      body: JSON.stringify({ body: "調査中", idempotencyKey: "note-key-1" }),
    });
    expect(last("addNote")?.args.slice(1, 3)).toEqual([
      "t1",
      { body: "調査中", idempotencyKey: "note-key-1" },
    ]);
  });

  it("treats a binding that is not granted this project as configuration", async () => {
    answer.listTickets = { ok: false, error: { code: "FORBIDDEN", message: "props" } };
    expect((await request("/tickets")).status).toBe(503);
  });

  it("turns anything else the platform says into a plain 502", async () => {
    answer.listTickets = { ok: false, error: { code: "INTERNAL_ERROR", message: "secret detail" } };
    const response = await request("/tickets");
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain("secret detail");
  });

  it("is bound to the platform's ProjectOperator for this project only", () => {
    const config = readFileSync(new URL("../../cloudflare.config.ts", import.meta.url), "utf8");
    const block = config.slice(config.indexOf("INQUIRY_OPERATOR: bindings.worker("));
    const binding = block.slice(0, block.indexOf("}),"));
    expect(binding).toMatch(/exportName: "ProjectOperator"/);
    expect(binding).toContain(`projects: ["${INQUIRY_PROJECT_SLUG}"]`);
    expect(config).not.toContain("INQUIRY_API_ORIGIN");
  });
});
