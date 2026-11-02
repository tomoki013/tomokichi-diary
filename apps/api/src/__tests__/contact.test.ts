import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestContext } from "@tomokichi/infra-d1/testing-context";
import type { AppContext, ContactFiled, ContactFiling } from "@tomokichi/application";
import type { IntakeBinding } from "@inquiry-platform/sdk";
import { createApp } from "../app.js";
import type { Env } from "../env.js";
import { ADMIN_TICKET_URL, createContactMailer } from "../contact-mail.js";
import { createInquiryInbox, INQUIRY_PROJECT_BY_LANE, INQUIRY_PROJECT_SLUG } from "../inquiry.js";

/*
 * Why this exists: `/v1/contact` is the only unauthenticated write in the
 * system. The HTTP layer — Turnstile, the honeypot, the rate limit, the
 * fail-closed secrets and the redirect-with-reason — is where it is decided
 * what reaches the inquiry platform. These run the real Hono app with the
 * challenge verifier, the limiter and the platform stood in for.
 */

const SITE = "https://tomokichidiary.com";

let ctx: AppContext;
let filed: ContactFiling[];
let accepts: boolean;
let mailed: { filing: ContactFiling; filed: ContactFiled | null }[];
let mails: boolean;
let limiterKeys: string[];
let limiterAllows: boolean;

function configured(): Env {
  return {
    TURNSTILE_SECRET_KEY: "secret",
    IP_HASH_SALT: "salt",
    PUBLIC_SITE_URL: SITE,
    CONTACT_RATE_LIMITER: {
      limit: async ({ key }: { key: string }) => {
        limiterKeys.push(key);
        return { success: limiterAllows };
      },
    },
  } as unknown as Env;
}

function form(fields: Record<string, string>): RequestInit {
  const body = new URLSearchParams(fields);
  return {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "cf-connecting-ip": "203.0.113.5",
    },
    body,
  };
}

/** What the contact page's fetch sends: the same form, asking for JSON back. */
function asJson(init: RequestInit): RequestInit {
  return {
    ...init,
    headers: { ...(init.headers as Record<string, string>), accept: "application/json" },
  };
}

const valid = {
  name: "ともきち",
  email: "reader@example.com",
  subject: "記事について",
  body: "アブシンベルへのバスの時刻について教えてください。",
  "cf-turnstile-response": "token-ok",
};

function appWith(verifyChallenge: (secret: string, token: string) => Promise<boolean>) {
  return createApp({
    contextFactory: () => ctx,
    verifyChallenge: (secret, token) => verifyChallenge(secret, token),
  });
}

beforeEach(async () => {
  filed = [];
  accepts = true;
  mailed = [];
  mails = true;
  limiterKeys = [];
  limiterAllows = true;
  ctx = {
    ...(await createTestContext()),
    inquiry: {
      file: async (filing) => {
        filed.push(filing);
        return accepts ? { ticketNumber: "TK-000001" } : null;
      },
    },
    contactMail: {
      send: async (filing, ticket) => {
        mailed.push({ filing, filed: ticket });
        return mails;
      },
    },
  };
});

describe("POST /v1/contact", () => {
  it("mails a valid submission, files a copy and redirects back with ?sent=1", async () => {
    const app = appWith(async (secret, token) => secret === "secret" && token === "token-ok");
    const response = await app.request("/v1/contact", form(valid), configured());
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${SITE}/contact?sent=1`);

    expect(mailed).toHaveLength(1);
    expect(filed).toHaveLength(1);
    expect(mailed[0]).toEqual({ filing: filed[0], filed: { ticketNumber: "TK-000001" } });
    expect(filed[0]).toMatchObject({
      email: "reader@example.com",
      subject: "記事について",
      lane: "general",
    });
    expect(filed[0]?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    // The address reaches the limiter only as a salted hash, and the platform not at all.
    expect(limiterKeys[0]).not.toContain("203.0.113.5");
    expect(JSON.stringify(filed[0])).not.toContain("203.0.113.5");
    // Nothing is kept locally any more.
    expect(await ctx.repos.contactMessages.list(10)).toHaveLength(0);
  });

  it("files a topic key under its label and lane", async () => {
    const app = appWith(async () => true);
    const response = await app.request(
      "/v1/contact",
      form({ ...valid, subject: "work" }),
      configured(),
    );
    expect(response.headers.get("location")).toBe(`${SITE}/contact?sent=1`);
    expect(filed[0]).toMatchObject({ subject: "お仕事・取材の相談", lane: "media" });
  });

  it("refuses a topic the form does not offer, before the rate limit", async () => {
    const app = appWith(async () => true);
    const response = await app.request(
      "/v1/contact",
      form({ ...valid, subject: "SEO対策のご提案" }),
      configured(),
    );
    expect(response.headers.get("location")).toBe(`${SITE}/contact?error=invalid`);
    expect(limiterKeys).toHaveLength(0);
    expect(filed).toHaveLength(0);
  });

  it("still mails the inbox when the platform refused, saying so", async () => {
    const app = appWith(async () => true);
    accepts = false;
    await app.request("/v1/contact", form(valid), configured());
    expect(mailed[0]?.filed).toBeNull();
  });

  it("fails closed when a secret or the limiter is missing", async () => {
    const app = appWith(async () => true);
    const { TURNSTILE_SECRET_KEY, IP_HASH_SALT, CONTACT_RATE_LIMITER } = configured();
    for (const env of [
      { IP_HASH_SALT, CONTACT_RATE_LIMITER },
      { TURNSTILE_SECRET_KEY, CONTACT_RATE_LIMITER },
      { TURNSTILE_SECRET_KEY, IP_HASH_SALT },
      { PUBLIC_SITE_URL: SITE },
    ]) {
      const response = await app.request("/v1/contact", form(valid), env as unknown as Env);
      // Back to the form with a message, never a bare error body.
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(`${SITE}/contact?error=unavailable`);
    }
    expect(filed).toHaveLength(0);
  });

  it("silently drops a submission that filled the honeypot", async () => {
    const app = appWith(async () => true);
    const response = await app.request(
      "/v1/contact",
      form({ ...valid, website: "https://spam.example" }),
      configured(),
    );
    // Looks like success to the bot; nothing is filed.
    expect(response.headers.get("location")).toBe(`${SITE}/contact?sent=1`);
    expect(filed).toHaveLength(0);
  });

  it("rejects a missing or failed challenge without filing anything", async () => {
    const app = appWith(async (_secret, token) => token === "token-ok");
    const missing = await app.request(
      "/v1/contact",
      form({ ...valid, "cf-turnstile-response": "" }),
      configured(),
    );
    expect(missing.headers.get("location")).toBe(`${SITE}/contact?error=challenge`);
    const failed = await app.request(
      "/v1/contact",
      form({ ...valid, "cf-turnstile-response": "token-bad" }),
      configured(),
    );
    expect(failed.headers.get("location")).toBe(`${SITE}/contact?error=challenge`);
    expect(filed).toHaveLength(0);
  });

  it("reports invalid input without spending the sender's rate limit", async () => {
    const app = appWith(async () => true);
    const short = await app.request("/v1/contact", form({ ...valid, body: "短い" }), configured());
    expect(short.headers.get("location")).toBe(`${SITE}/contact?error=invalid`);

    const empty = await app.request("/v1/contact", { method: "POST" }, configured());
    expect(empty.headers.get("location")).toBe(`${SITE}/contact?error=invalid`);

    expect(limiterKeys).toHaveLength(0);
    expect(filed).toHaveLength(0);
  });

  it("reports a too-fast resubmission without filing it", async () => {
    const app = appWith(async () => true);
    limiterAllows = false;
    const response = await app.request("/v1/contact", form(valid), configured());
    expect(response.headers.get("location")).toBe(`${SITE}/contact?error=toofast`);
    expect(filed).toHaveLength(0);
  });

  it("accepts when either the mail or the copy went through", async () => {
    const app = appWith(async () => true);
    accepts = false;
    const mailOnly = await app.request("/v1/contact", form(valid), configured());
    expect(mailOnly.headers.get("location")).toBe(`${SITE}/contact?sent=1`);

    accepts = true;
    mails = false;
    const copyOnly = await app.request("/v1/contact", form(valid), configured());
    expect(copyOnly.headers.get("location")).toBe(`${SITE}/contact?sent=1`);
  });

  it("tells the sender to try again when neither the mail nor the copy went through", async () => {
    const app = appWith(async () => true);
    accepts = false;
    mails = false;
    const refused = await app.request("/v1/contact", form(valid), configured());
    expect(refused.headers.get("location")).toBe(`${SITE}/contact?error=unavailable`);

    ctx = { ...ctx, inquiry: undefined, contactMail: undefined };
    const unbound = await app.request("/v1/contact", form(valid), configured());
    expect(unbound.headers.get("location")).toBe(`${SITE}/contact?error=unavailable`);
  });

  it("answers once the copy is filed and mails after the response", async () => {
    const app = appWith(async () => true);
    const mail = Promise.withResolvers<boolean>();
    ctx = {
      ...ctx,
      contactMail: {
        send: (filing, ticket) => {
          mailed.push({ filing, filed: ticket });
          return mail.promise;
        },
      },
    };
    const pending: Promise<unknown>[] = [];
    const execution = {
      waitUntil: (task: Promise<unknown>) => pending.push(task),
      passThroughOnException: () => {},
      props: {},
    };

    const response = await app.request("/v1/contact", form(valid), configured(), execution);
    expect(response.headers.get("location")).toBe(`${SITE}/contact?sent=1`);
    // The mail was started but not waited for; the runtime is told to finish it.
    expect(mailed).toHaveLength(1);
    expect(pending).toHaveLength(1);
    mail.resolve(true);
    await Promise.all(pending);
  });

  it("waits for the mail when the copy could not be filed", async () => {
    const app = appWith(async () => true);
    accepts = false;
    const pending: Promise<unknown>[] = [];
    const execution = {
      waitUntil: (task: Promise<unknown>) => pending.push(task),
      passThroughOnException: () => {},
      props: {},
    };
    const response = await app.request("/v1/contact", form(valid), configured(), execution);
    expect(response.headers.get("location")).toBe(`${SITE}/contact?sent=1`);
    expect(mailed).toHaveLength(1);
    expect(pending).toHaveLength(0);
  });

  it("sends the sender back to the form when something throws", async () => {
    const app = appWith(async () => {
      throw new Error("siteverify timed out");
    });
    const response = await app.request("/v1/contact", form(valid), configured());
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${SITE}/contact?error=unavailable`);
    expect(filed).toHaveLength(0);
  });

  it("answers the page's fetch with JSON instead of a redirect", async () => {
    const app = appWith(async (_secret, token) => token === "token-ok");

    const sent = await app.request("/v1/contact", asJson(form(valid)), configured());
    expect(sent.status).toBe(200);
    expect(await sent.json()).toEqual({ result: "sent" });

    const challenge = await app.request(
      "/v1/contact",
      asJson(form({ ...valid, "cf-turnstile-response": "token-bad" })),
      configured(),
    );
    expect(challenge.status).toBe(400);
    expect(await challenge.json()).toEqual({ result: "challenge" });

    limiterAllows = false;
    const tooFast = await app.request("/v1/contact", asJson(form(valid)), configured());
    expect(tooFast.status).toBe(429);
    expect(await tooFast.json()).toEqual({ result: "toofast" });

    const unconfigured = await app.request("/v1/contact", asJson(form(valid)), {
      PUBLIC_SITE_URL: SITE,
    } as unknown as Env);
    expect(unconfigured.status).toBe(503);
    expect(await unconfigured.json()).toEqual({ result: "unavailable" });
  });
});

const binding = (submitContact: IntakeBinding["submitContact"]) =>
  ({ submitContact }) as unknown as IntakeBinding;

describe("createInquiryInbox", () => {
  const filing: ContactFiling = {
    idempotencyKey: "test-filing-1",
    lane: "general",
    name: "ともきち",
    email: "reader@example.com",
    subject: "記事について",
    body: "アブシンベルへのバスの時刻について教えてください。",
  };

  it("files a web-form contact for this site's project", async () => {
    const submitContact = vi.fn().mockResolvedValue({
      ok: true,
      value: { ticketNumber: "TK-000001", receiptId: "r1", status: "OPEN", duplicate: false },
    });
    expect(await createInquiryInbox(binding(submitContact)).file(filing)).toEqual({
      ticketNumber: "TK-000001",
    });
    expect(submitContact).toHaveBeenCalledWith({
      projectSlug: INQUIRY_PROJECT_SLUG,
      idempotencyKey: filing.idempotencyKey,
      name: filing.name,
      email: filing.email,
      subject: filing.subject,
      message: filing.body,
      channel: "web_form",
    });
  });

  it("treats a refusal and a thrown binding alike", async () => {
    const refused = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: "FORBIDDEN", message: "not granted" },
    });
    expect(await createInquiryInbox(binding(refused)).file(filing)).toBeNull();
    const thrown = vi.fn().mockRejectedValue(new Error("binding is down"));
    expect(await createInquiryInbox(binding(thrown)).file(filing)).toBeNull();
  });

  it("files every lane to a project both bindings are granted", () => {
    const config = readFileSync(new URL("../../cloudflare.config.ts", import.meta.url), "utf8");
    for (const slug of Object.values(INQUIRY_PROJECT_BY_LANE)) {
      expect(config).toContain(`projects: ["${slug}"`);
    }
  });

  it("is granted exactly this site's project in cloudflare.config.ts", () => {
    const config = readFileSync(new URL("../../cloudflare.config.ts", import.meta.url), "utf8");
    const block = config.slice(config.indexOf("INQUIRY: bindings.worker("));
    const intake = block.slice(0, block.indexOf("}),"));
    expect(intake).toMatch(/exportName: "Intake"/);
    expect(intake).toContain(`projects: ["${INQUIRY_PROJECT_SLUG}"]`);
  });
});

describe("createContactMailer", () => {
  const filing: ContactFiling = {
    idempotencyKey: "test-filing-1",
    lane: "media",
    name: "ともきち",
    email: "reader@example.com",
    subject: "お仕事・取材の相談",
    body: "旅行特集の記事を書いていただけないでしょうか。",
  };
  const addresses = { from: "noreply@example.com", to: "inbox@example.com" };

  it("points a filed message at its ticket, with no Reply-To to answer from", async () => {
    const send = vi.fn().mockResolvedValue({ messageId: "m1" });
    const mailer = createContactMailer({ send }, addresses);
    expect(await mailer.send(filing, { ticketNumber: "TK-000042" })).toBe(true);
    const [message] = send.mock.calls[0] as [Record<string, unknown>];
    expect(message).toMatchObject({
      to: "inbox@example.com",
      from: { email: "noreply@example.com" },
      subject: "[ともきちの旅行日記/メディア・お仕事] TK-000042 お仕事・取材の相談",
    });
    expect(message).not.toHaveProperty("replyTo");
    expect(message.text).toContain(filing.body);
    expect(message.text).toContain(`${ADMIN_TICKET_URL}TK-000042`);
  });

  it("makes the reader the Reply-To when the platform has no copy", async () => {
    const send = vi.fn().mockResolvedValue({ messageId: "m1" });
    expect(await createContactMailer({ send }, addresses).send(filing, null)).toBe(true);
    const [message] = send.mock.calls[0] as [Record<string, unknown>];
    expect(message).toMatchObject({
      replyTo: { name: "ともきち", email: "reader@example.com" },
      subject: "[ともきちの旅行日記/メディア・お仕事] お仕事・取材の相談",
    });
    expect(message.text).toContain("このメールに返信すると、送信者に届きます。");
  });

  it("reports a failed send as false instead of throwing", async () => {
    const send = vi.fn().mockRejectedValue(new Error("destination not verified"));
    expect(await createContactMailer({ send }, addresses).send(filing, null)).toBe(false);
  });

  it("is pinned to the blog's inbox in cloudflare.config.ts", () => {
    const config = readFileSync(new URL("../../cloudflare.config.ts", import.meta.url), "utf8");
    expect(config).toContain('destinationAddress: "tomokichidiary@gmail.com"');
    expect(config).toContain('CONTACT_MAIL_TO: bindings.text("tomokichidiary@gmail.com")');
  });
});
