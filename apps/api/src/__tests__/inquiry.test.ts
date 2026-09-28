import { beforeEach, describe, expect, it } from "vitest";
import { createTestContext } from "@tomokichi/infra-d1/testing-context";
import type { AppContext } from "@tomokichi/application";
import { createApp } from "../app.js";
import type { Env } from "../env.js";
import { createInquiryOperator, forgetInquiryProject } from "../inquiry-operator.js";

/*
 * The admin's inquiry screen talks to the shared platform through this API.
 * What matters here is the narrowing: the diary admin sees this site's tickets
 * and nothing else, sends only the fields it names, and never lets the
 * platform's own errors or other projects' data through. The platform is a
 * stand-in `fetch` behind the real operator client, so the Access headers and
 * paths are checked too.
 */

const TOKEN = "test-admin-token";
const auth = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
const DIARY = "app-diary";

const env = {
  ADMIN_TOKEN: TOKEN,
  INQUIRY_API_ORIGIN: "https://admin.example.com",
  INQUIRY_ACCESS_CLIENT_ID: "client-id.access",
  INQUIRY_ACCESS_CLIENT_SECRET: "client-secret",
} as unknown as Env;

interface Call {
  method: string;
  path: string;
  body: unknown;
  headers: Headers;
}

let ctx: AppContext;
let calls: Call[];
let apps: { id: string; slug: string }[];
let tickets: Record<string, ReturnType<typeof ticket>>;
let upstream: ((call: Call) => Response | undefined) | undefined;
let diarySignature: string | undefined;

function ticket(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    ticket_number: `TK-${id}`,
    type: "INQUIRY",
    status: "NEW",
    resolution: null,
    priority: "P3",
    impact: "MEDIUM",
    urgency: "MEDIUM",
    service_id: DIARY,
    subject: "記事について",
    summary: null,
    requester_email: "reader@example.com",
    created_at: "2026-09-27T00:00:00.000Z",
    updated_at: "2026-09-27T00:00:00.000Z",
    acknowledged_at: null,
    first_response_at: null,
    resolved_at: null,
    closed_at: null,
    next_action: "返信する",
    next_action_at: null,
    revision: 3,
    sla_state: "OK",
    thread_id: `thread-${id}`,
    ...overrides,
  };
}

const ok = (data: unknown): Response => Response.json({ ok: true, data, requestId: "r" });

const platform: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  const call: Call = {
    method: init?.method ?? "GET",
    path: `${url.pathname}${url.search}`,
    body: init?.body ? JSON.parse(String(init.body)) : undefined,
    headers: new Headers(init?.headers),
  };
  calls.push(call);
  const overridden = upstream?.(call);
  if (overridden) return overridden;

  if (url.pathname === "/api/apps") return ok(apps);
  if (url.pathname === "/api/session") return ok({ mailConfigured: true });
  if (url.pathname === "/api/support/mail-settings" && call.method === "GET") {
    return ok([
      { signatureText: "Tomokichi Studio\n080-0000-0000", updatedAt: "x" },
      { appId: "app-remeet", signatureText: "Remeet team", updatedAt: "x" },
      ...(diarySignature === undefined
        ? []
        : [{ appId: DIARY, signatureText: diarySignature, updatedAt: "x" }]),
    ]);
  }
  if (url.pathname === "/api/tickets") return ok({ items: Object.values(tickets), total: 2 });
  const match = /^\/api\/tickets\/([^/]+)$/.exec(url.pathname);
  if (match && call.method === "GET") {
    const found = tickets[match[1]!];
    return found
      ? ok({
          ticket: found,
          timeline: [
            {
              kind: "message",
              value: {
                id: "m1",
                direction: "INBOUND",
                visibility: "PUBLIC",
                sender: "reader@example.com",
                body: "バスの時刻を教えてください",
                created_at: found.created_at,
              },
            },
            {
              kind: "message",
              value: {
                id: "m2",
                direction: "OUTBOUND",
                visibility: "INTERNAL",
                sender: null,
                body: "確認中",
                created_at: found.created_at,
              },
            },
          ],
          totalTimeline: 2,
          relations: [],
        })
      : Response.json(
          { ok: false, error: { code: "NOT_FOUND", message: "x" }, requestId: "r" },
          { status: 404 },
        );
  }
  return ok({});
};

function app() {
  return createApp({
    contextFactory: () => ctx,
    inquiryOperator: (e) => createInquiryOperator(e, platform),
  });
}

function request(path: string, init: RequestInit = {}, e: Env = env) {
  return app().request(`/v1/admin/inquiry${path}`, { headers: auth, ...init }, e);
}

beforeEach(async () => {
  ctx = await createTestContext();
  forgetInquiryProject();
  calls = [];
  upstream = undefined;
  diarySignature = undefined;
  apps = [
    { id: DIARY, slug: "tomokichi-diary" },
    { id: "app-remeet", slug: "remeet" },
  ];
  tickets = { t1: ticket("t1"), t2: ticket("t2") };
});

describe("/v1/admin/inquiry", () => {
  it("sits behind the admin gate", async () => {
    const response = await app().request("/v1/admin/inquiry/tickets", {}, env);
    expect(response.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("reports an unconfigured platform instead of calling anything", async () => {
    const response = await request("/status", {}, { ADMIN_TOKEN: TOKEN } as unknown as Env);
    expect(await response.json()).toEqual({
      configured: false,
      registered: false,
      mailConfigured: false,
    });
    expect(calls).toHaveLength(0);

    const list = await request("/tickets", {}, { ADMIN_TOKEN: TOKEN } as unknown as Env);
    expect(list.status).toBe(503);
  });

  it("reports an unregistered project, and refuses to list without one", async () => {
    apps = [{ id: "app-remeet", slug: "remeet" }];
    const status = await (await request("/status")).json();
    expect(status).toMatchObject({ configured: true, registered: false });
    expect((await request("/tickets")).status).toBe(503);
  });

  it("presents the Access service token and never follows a login redirect", async () => {
    await request("/tickets");
    const first = calls[0]!;
    expect(first.headers.get("CF-Access-Client-Id")).toBe("client-id.access");
    expect(first.headers.get("CF-Access-Client-Secret")).toBe("client-secret");
    expect(first.headers.get("authorization")).toBeNull();
  });

  it("lists only this site's tickets", async () => {
    const response = await request("/tickets?status=open&query=%E3%83%90%E3%82%B9&offset=30");
    const body = await response.json();
    const list = calls.find((call) => call.path.startsWith("/api/tickets?"))!;
    const params = new URL(`https://x${list.path}`).searchParams;
    expect(params.get("service_id")).toBe(DIARY);
    expect(params.get("queue")).toBe("OPEN");
    expect(params.get("query")).toBe("バス");
    expect(params.get("offset")).toBe("30");
    expect(body.items[0]).toMatchObject({ id: "t1", number: "TK-t1", status: "NEW" });
  });

  it("ignores a status filter it does not know", async () => {
    await request("/tickets?status=DROP%20TABLE");
    const list = calls.find((call) => call.path.startsWith("/api/tickets?"))!;
    expect(list.path).not.toContain("status=");
  });

  it("shows a ticket with its timeline, telling notes from mail", async () => {
    const body = await (await request("/tickets/t1")).json();
    expect(body).toMatchObject({
      id: "t1",
      revision: 3,
      canReply: true,
      allowedStatuses: ["TRIAGE", "ACKNOWLEDGED", "RESOLVED"],
    });
    expect(body.timeline.map((item: { direction: string }) => item.direction)).toEqual([
      "inbound",
      "note",
    ]);
  });

  it("answers 404 for another project's ticket, exactly as for a missing one", async () => {
    tickets["other"] = ticket("other", { service_id: "app-remeet" });
    const other = await request("/tickets/other");
    const missing = await request("/tickets/nope");
    expect(other.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await other.json()).toMatchObject({ error: { code: "API_NOT_FOUND" } });

    const reply = await request("/tickets/other/reply", {
      method: "POST",
      body: JSON.stringify({ body: "こんにちは", idempotencyKey: "reply-key-1" }),
    });
    expect(reply.status).toBe(404);
    expect(calls.some((call) => call.path.includes("/reply"))).toBe(false);
  });

  it("changes status without touching fields that were not sent", async () => {
    const response = await request("/tickets/t1", {
      method: "PATCH",
      body: JSON.stringify({ revision: 3, status: "ACKNOWLEDGED" }),
    });
    expect(response.status).toBe(200);
    const patch = calls.find((call) => call.method === "PATCH")!;
    expect(patch.path).toBe("/api/tickets/t1");
    expect(patch.body).toEqual({ revision: 3, status: "ACKNOWLEDGED" });
  });

  it("clears the next action only when asked to", async () => {
    await request("/tickets/t1", {
      method: "PATCH",
      body: JSON.stringify({ revision: 3, nextAction: null, nextActionAt: null }),
    });
    const patch = calls.find((call) => call.method === "PATCH")!;
    expect(patch.body).toEqual({ revision: 3, next_action: null, next_action_at: null });
  });

  it("rejects a change it does not recognise before calling the platform", async () => {
    const response = await request("/tickets/t1", {
      method: "PATCH",
      body: JSON.stringify({ revision: 3, status: "DELETED" }),
    });
    expect(response.status).toBe(400);
    expect(calls.some((call) => call.method === "PATCH")).toBe(false);
  });

  it("passes a stale revision back as a conflict", async () => {
    upstream = (call) =>
      call.method === "PATCH"
        ? Response.json(
            {
              ok: false,
              error: { code: "CONFLICT", message: "他の人が更新しました" },
              requestId: "r",
            },
            { status: 409 },
          )
        : undefined;
    const response = await request("/tickets/t1", {
      method: "PATCH",
      body: JSON.stringify({ revision: 1, status: "ACKNOWLEDGED" }),
    });
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("API_CONFLICT");
  });

  it("sends a reply as a body only, into the ticket's own thread", async () => {
    const response = await request("/tickets/t1/reply", {
      method: "POST",
      body: JSON.stringify({ body: "ご連絡ありがとうございます。", idempotencyKey: "reply-key-1" }),
    });
    expect(response.status).toBe(200);
    const reply = calls.find((call) => call.path.endsWith("/reply"))!;
    expect(reply.path).toBe("/api/support/threads/thread-t1/reply");
    expect(reply.body).toEqual({
      bodyText: "ご連絡ありがとうございます。",
      idempotencyKey: "reply-key-1",
      reopenIfResolved: false,
    });
  });

  it("refuses to reply where there is nobody to reply to", async () => {
    tickets["t1"] = ticket("t1", { requester_email: null });
    const response = await request("/tickets/t1/reply", {
      method: "POST",
      body: JSON.stringify({ body: "こんにちは", idempotencyKey: "reply-key-1" }),
    });
    expect(response.status).toBe(409);
    expect(calls.some((call) => call.path.endsWith("/reply"))).toBe(false);
  });

  it("adds an internal note with its idempotency key", async () => {
    await request("/tickets/t1/notes", {
      method: "POST",
      body: JSON.stringify({ body: "調査中", idempotencyKey: "note-key-1" }),
    });
    const note = calls.find((call) => call.path.endsWith("/notes"))!;
    expect(note.body).toEqual({ body: "調査中", idempotencyKey: "note-key-1" });
  });

  it("turns a rejected service token into a plain 502", async () => {
    upstream = () =>
      Response.json(
        { ok: false, error: { code: "UNAUTHORIZED", message: "secret detail" }, requestId: "r" },
        { status: 401 },
      );
    const response = await request("/tickets");
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain("secret detail");
  });

  describe("signature", () => {
    it("reports the deployment's signature in use when the site has none", async () => {
      const body = await (await request("/signature")).json();
      expect(body).toEqual({ signature: "", usesDefault: true });
      // Neither the deployment's nor another project's text is handed over.
      expect(JSON.stringify(body)).not.toContain("080");
      expect(JSON.stringify(body)).not.toContain("Remeet");
    });

    it("returns the site's own signature", async () => {
      diarySignature = "ともきちの旅行日記";
      expect(await (await request("/signature")).json()).toEqual({
        signature: "ともきちの旅行日記",
        usesDefault: false,
      });
    });

    it("always saves to this site's project, whatever the body says", async () => {
      const response = await request("/signature", {
        method: "PUT",
        body: JSON.stringify({ signature: "ともきち", appId: "app-remeet" }),
      });
      expect(response.status).toBe(200);
      const put = calls.find((call) => call.method === "PUT")!;
      expect(put.path).toBe("/api/support/mail-settings");
      expect(put.body).toEqual({ appId: DIARY, signatureText: "ともきち" });
    });

    it("refuses an over-long signature before calling the platform", async () => {
      const response = await request("/signature", {
        method: "PUT",
        body: JSON.stringify({ signature: "あ".repeat(2001) }),
      });
      expect(response.status).toBe(400);
      expect(calls.some((call) => call.method === "PUT")).toBe(false);
    });
  });
});
