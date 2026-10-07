import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestContext } from "@tomokichi/infra-d1/testing-context";
import type { AppContext, ContactFiling } from "@tomokichi/application";
import type { IntakeBinding } from "@inquiry-platform/sdk";
import { createApp } from "../app.js";
import type { Env } from "../env.js";
import { createInquiryInbox, INQUIRY_PROJECT_SLUG } from "../inquiry.js";

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
  limiterKeys = [];
  limiterAllows = true;
  ctx = {
    ...(await createTestContext()),
    inquiry: {
      file: async (filing) => {
        filed.push(filing);
        return accepts;
      },
    },
  };
});

describe("POST /v1/contact", () => {
  it("files a valid submission on the platform and redirects back with ?sent=1", async () => {
    const app = appWith(async (secret, token) => secret === "secret" && token === "token-ok");
    const response = await app.request("/v1/contact", form(valid), configured());
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${SITE}/contact?sent=1`);

    expect(filed).toHaveLength(1);
    expect(filed[0]).toMatchObject({ email: "reader@example.com", subject: "記事について" });
    expect(filed[0]?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    // The address reaches the limiter only as a salted hash, and the platform not at all.
    expect(limiterKeys[0]).not.toContain("203.0.113.5");
    expect(JSON.stringify(filed[0])).not.toContain("203.0.113.5");
    // Nothing is kept locally any more.
    expect(await ctx.repos.contactMessages.list(10)).toHaveLength(0);
  });

  it("fails closed when a secret or the limiter is missing", async () => {
    const app = appWith(async () => true);
    const { TURNSTILE_SECRET_KEY, IP_HASH_SALT, CONTACT_RATE_LIMITER } = configured();
    for (const env of [
      { IP_HASH_SALT, CONTACT_RATE_LIMITER },
      { TURNSTILE_SECRET_KEY, CONTACT_RATE_LIMITER },
      { TURNSTILE_SECRET_KEY, IP_HASH_SALT },
      {},
    ]) {
      const response = await app.request("/v1/contact", form(valid), env as unknown as Env);
      expect(response.status).toBe(500);
      expect((await response.json()).error.code).toBe("API_INTERNAL");
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

  it("tells the sender to try again when the platform refuses", async () => {
    const app = appWith(async () => true);
    accepts = false;
    const response = await app.request("/v1/contact", form(valid), configured());
    expect(response.headers.get("location")).toBe(`${SITE}/contact?error=unavailable`);
  });

  it("refuses rather than claims success when the platform is not bound", async () => {
    const app = appWith(async () => true);
    ctx = { ...ctx, inquiry: undefined };
    const response = await app.request("/v1/contact", form(valid), configured());
    expect(response.headers.get("location")).toBe(`${SITE}/contact?error=unavailable`);
  });
});

const binding = (submitContact: IntakeBinding["submitContact"]) =>
  ({ submitContact }) as unknown as IntakeBinding;

describe("createInquiryInbox", () => {
  const filing: ContactFiling = {
    idempotencyKey: "test-filing-1",
    name: "ともきち",
    email: "reader@example.com",
    subject: "記事について",
    body: "アブシンベルへのバスの時刻について教えてください。",
  };

  it("files a web-form contact for this site's project", async () => {
    const submitContact = vi.fn().mockResolvedValue({
      ok: true,
      value: { ticketNumber: "1", status: "OPEN", duplicate: false },
    });
    expect(await createInquiryInbox(binding(submitContact)).file(filing)).toBe(true);
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
    expect(await createInquiryInbox(binding(refused)).file(filing)).toBe(false);
    const thrown = vi.fn().mockRejectedValue(new Error("binding is down"));
    expect(await createInquiryInbox(binding(thrown)).file(filing)).toBe(false);
  });

  it("is granted exactly this site's project in cloudflare.config.ts", () => {
    const config = readFileSync(new URL("../../cloudflare.config.ts", import.meta.url), "utf8");
    const block = config.slice(config.indexOf("INQUIRY: bindings.worker("));
    const intake = block.slice(0, block.indexOf("}),"));
    expect(intake).toMatch(/exportName: "Intake"/);
    expect(intake).toContain(`projects: ["${INQUIRY_PROJECT_SLUG}"]`);
  });
});
