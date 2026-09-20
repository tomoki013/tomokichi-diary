import { beforeEach, describe, expect, it } from "vitest";
import { createTestContext } from "@tomokichi/infra-d1/testing-context";
import type { AppContext } from "@tomokichi/application";
import { createApp } from "../app.js";
import type { Env } from "../env.js";

/*
 * Why this exists: `/v1/contact` is the only unauthenticated write in the
 * system. The domain rules (validation, spam, rate limit) are unit-tested, but
 * the HTTP layer — where Turnstile, the honeypot, the fail-closed secrets and
 * the redirect-with-reason all live — was not. These run the real Hono app
 * against in-memory D1 with the challenge verifier injected.
 */

const SITE = "https://tomokichidiary.com";
const configured = {
  TURNSTILE_SECRET_KEY: "secret",
  IP_HASH_SALT: "salt",
  PUBLIC_SITE_URL: SITE,
} as unknown as Env;

let ctx: AppContext;

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
  ctx = await createTestContext();
});

describe("POST /v1/contact", () => {
  it("stores a valid submission and redirects back with ?sent=1", async () => {
    const app = appWith(async (secret, token) => secret === "secret" && token === "token-ok");
    const response = await app.request("/v1/contact", form(valid), configured);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${SITE}/contact?sent=1`);

    const stored = await ctx.repos.contactMessages.list(10);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ email: "reader@example.com", status: "unread" });
    // The address is hashed for rate limiting; the IP itself is never stored.
    expect(JSON.stringify(stored[0])).not.toContain("203.0.113.5");
  });

  it("fails closed when a secret is missing", async () => {
    const app = appWith(async () => true);
    for (const env of [{ IP_HASH_SALT: "salt" }, { TURNSTILE_SECRET_KEY: "secret" }, {}]) {
      const response = await app.request("/v1/contact", form(valid), env as unknown as Env);
      expect(response.status).toBe(500);
      expect((await response.json()).error.code).toBe("API_INTERNAL");
    }
    expect(await ctx.repos.contactMessages.list(10)).toHaveLength(0);
  });

  it("silently drops a submission that filled the honeypot", async () => {
    const app = appWith(async () => true);
    const response = await app.request(
      "/v1/contact",
      form({ ...valid, website: "https://spam.example" }),
      configured,
    );
    // Looks like success to the bot; nothing is stored.
    expect(response.headers.get("location")).toBe(`${SITE}/contact?sent=1`);
    expect(await ctx.repos.contactMessages.list(10)).toHaveLength(0);
  });

  it("rejects a missing or failed challenge without storing anything", async () => {
    const app = appWith(async (_secret, token) => token === "token-ok");
    const missing = await app.request(
      "/v1/contact",
      form({ ...valid, "cf-turnstile-response": "" }),
      configured,
    );
    expect(missing.headers.get("location")).toBe(`${SITE}/contact?error=challenge`);
    const failed = await app.request(
      "/v1/contact",
      form({ ...valid, "cf-turnstile-response": "token-bad" }),
      configured,
    );
    expect(failed.headers.get("location")).toBe(`${SITE}/contact?error=challenge`);
    expect(await ctx.repos.contactMessages.list(10)).toHaveLength(0);
  });

  it("reports invalid input and a too-fast resubmission as distinct reasons", async () => {
    const app = appWith(async () => true);
    const short = await app.request("/v1/contact", form({ ...valid, body: "短い" }), configured);
    expect(short.headers.get("location")).toBe(`${SITE}/contact?error=invalid`);

    const empty = await app.request("/v1/contact", { method: "POST" }, configured);
    expect(empty.headers.get("location")).toBe(`${SITE}/contact?error=invalid`);

    const first = await app.request("/v1/contact", form(valid), configured);
    expect(first.headers.get("location")).toBe(`${SITE}/contact?sent=1`);
    // Same sender, same fixed clock: inside the rate-limit window.
    const second = await app.request("/v1/contact", form(valid), configured);
    expect(second.headers.get("location")).toBe(`${SITE}/contact?error=toofast`);
    expect(await ctx.repos.contactMessages.list(10)).toHaveLength(1);
  });

  it("keeps a spam-looking message but flags it instead of dropping it", async () => {
    const app = appWith(async () => true);
    const links = Array.from({ length: 6 }, (_, i) => `https://spam${i}.example/x`).join(" ");
    await app.request("/v1/contact", form({ ...valid, body: `見てください ${links}` }), configured);
    const [stored] = await ctx.repos.contactMessages.list(10);
    expect(stored?.status).toBe("spam");
  });
});
