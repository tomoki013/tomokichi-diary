import { beforeEach, describe, expect, it } from "vitest";
import { createTestContext } from "@tomokichi/infra-d1/testing-context";
import type { AppContext } from "@tomokichi/application";
import {
  createProjectOperatorClient,
  type OperatorTicketDetail,
  type ProjectOperatorApi,
} from "@inquiry-platform/sdk";
import { readFileSync } from "node:fs";
import { createApp } from "../app.js";
import type { Env } from "../env.js";
import { INQUIRY_PROJECT_SLUG } from "../inquiry.js";

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
let answer: Partial<Record<keyof ProjectOperatorApi, unknown>>;

function ticket(overrides: Partial<OperatorTicketDetail> = {}): OperatorTicketDetail {
  return {
    id: "t1",
    number: "TK-000001",
    status: "NEW",
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

/** A stand-in platform: records what it was asked, answers what the test set. */
const platform = new Proxy({} as ProjectOperatorApi, {
  get:
    (_target, method: string) =>
    async (...args: unknown[]) => {
      calls.push({ method, args });
      return (
        answer[method as keyof ProjectOperatorApi] ?? {
          ok: true,
          value:
            method === "project" || method === "setSignature"
              ? { ...project, mailConfigured: true, signature: "" }
              : method === "listTickets"
                ? { items: [ticket()], total: 31 }
                : ticket(),
        }
      );
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
});

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
    });
    expect((await request("/tickets", {}, false)).status).toBe(503);
  });

  it("reports an unregistered project", async () => {
    answer.project = { ok: false, error: { code: "NOT_FOUND", message: "x" } };
    expect(await (await request("/status")).json()).toEqual({
      configured: true,
      registered: false,
      mailConfigured: false,
    });
  });

  it("names only this site's project, whatever the request says", async () => {
    await request("/tickets?status=open&query=%E3%83%90%E3%82%B9&offset=30&project=remeet");
    expect(last("listTickets")?.args).toEqual([
      "tomokichi-diary",
      { status: "open", query: "バス", limit: 30, offset: 30 },
    ]);
    expect(calls.every((call) => call.args[0] === "tomokichi-diary")).toBe(true);
  });

  it("pages what the platform returns", async () => {
    const body = await (await request("/tickets")).json();
    expect(body).toMatchObject({ total: 31, offset: 0, limit: 30, hasMore: true });
    expect(body.items[0]).toMatchObject({ id: "t1", number: "TK-000001", status: "NEW" });
  });

  it("ignores a status filter it does not know", async () => {
    await request("/tickets?status=DROP%20TABLE");
    expect(last("listTickets")?.args[1]).toEqual({ limit: 30, offset: 0 });
  });

  it("opens a ticket by number, as a notification link carries it", async () => {
    const body = await (await request("/tickets/TK-000001")).json();
    expect(last("getTicket")?.args).toEqual(["tomokichi-diary", "TK-000001", 0]);
    expect(body).toMatchObject({ id: "t1", revision: 3, canReply: true });
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

  it("sends a reply as a body and a key only", async () => {
    const response = await request("/tickets/t1/reply", {
      method: "POST",
      body: JSON.stringify({ body: "ご連絡ありがとうございます。", idempotencyKey: "reply-key-1" }),
    });
    expect(response.status).toBe(200);
    expect(last("reply")?.args).toEqual([
      "tomokichi-diary",
      "t1",
      {
        body: "ご連絡ありがとうございます。",
        idempotencyKey: "reply-key-1",
        reopenIfResolved: false,
      },
      { id: "admin-token" },
    ]);
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

  describe("signature", () => {
    it("reports the deployment's signature in use when the site has none", async () => {
      expect(await (await request("/signature")).json()).toEqual({
        signature: "",
        usesDefault: true,
      });
    });

    it("saves this site's signature", async () => {
      answer.setSignature = {
        ok: true,
        value: { ...project, mailConfigured: true, signature: "ともきち" },
      };
      const response = await request("/signature", {
        method: "PUT",
        body: JSON.stringify({ signature: "ともきち", appId: "app-remeet" }),
      });
      expect(await response.json()).toEqual({ signature: "ともきち", usesDefault: false });
      expect(last("setSignature")?.args).toEqual([
        "tomokichi-diary",
        "ともきち",
        { id: "admin-token" },
      ]);
    });

    it("refuses an over-long signature before calling the platform", async () => {
      const response = await request("/signature", {
        method: "PUT",
        body: JSON.stringify({ signature: "あ".repeat(2001) }),
      });
      expect(response.status).toBe(400);
      expect(last("setSignature")).toBeUndefined();
    });
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
