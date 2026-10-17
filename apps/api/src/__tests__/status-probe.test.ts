import { beforeEach, describe, expect, it } from "vitest";
import { createTestContext } from "@tomokichi/infra-d1/testing-context";
import type { AppContext } from "@tomokichi/application";
import { createProjectOperatorClient, type ProjectOperatorApi } from "@inquiry-platform/sdk";
import { createApp } from "../app.js";
import type { Env } from "../env.js";
import { INQUIRY_PROJECT_SLUG } from "../inquiry.js";

/*
 * The status platform reads the contact pipeline's state through
 * /internal/status-probe. It must stay invisible without the right token,
 * call the platform read-only, and say nothing beyond states and two numbers.
 */

const TOKEN = "probe-token-for-tests-0123456789abcdef";
const baseEnv = {
  STATUS_PROBE_TOKEN: TOKEN,
  TURNSTILE_SECRET_KEY: "turnstile-secret",
} as unknown as Env;

let ctx: AppContext;
let calls: string[];
let answers: Partial<Record<keyof ProjectOperatorApi, () => Promise<unknown>>>;

const platform = new Proxy({} as ProjectOperatorApi, {
  get: (_target, method: string) => async () => {
    calls.push(method);
    const answer = answers[method as keyof ProjectOperatorApi];
    if (answer) return answer();
    if (method === "project")
      return {
        ok: true,
        value: { id: "p", slug: INQUIRY_PROJECT_SLUG, name: "x", mailConfigured: true },
      };
    if (method === "listDeliveryJobs") return { ok: true, value: { items: [], total: 0 } };
    throw new Error(`unexpected call: ${method}`);
  },
});

function app(bound = true) {
  return createApp({
    contextFactory: () => ctx,
    inquiryOperator: () =>
      bound ? createProjectOperatorClient(platform, INQUIRY_PROJECT_SLUG) : null,
  });
}

function probe(init: { token?: string | null; env?: Partial<Env>; bound?: boolean } = {}) {
  const headers: Record<string, string> = {};
  const token = init.token === undefined ? TOKEN : init.token;
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return app(init.bound ?? true).request("/internal/status-probe", { headers }, {
    ...baseEnv,
    ...init.env,
  } as Env);
}

beforeEach(async () => {
  ctx = await createTestContext();
  calls = [];
  answers = {};
});

describe("GET /internal/status-probe", () => {
  it("does not exist without a configured token", async () => {
    const response = await probe({ env: { STATUS_PROBE_TOKEN: undefined } });
    expect(response.status).toBe(404);
    expect(calls).toEqual([]);
  });

  it.each([
    ["no token", null],
    ["a wrong token", "wrong-token"],
    ["a prefix of the token", TOKEN.slice(0, 10)],
  ])("answers like a missing route for %s", async (_label, token) => {
    const response = await probe({ token });
    const missing = await app().request("/internal/no-such-route", {}, baseEnv);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      ...(await missing.json()),
      error: expect.objectContaining({ message: "no route for /internal/status-probe" }),
    });
    expect(calls).toEqual([]);
  });

  it("reports a healthy pipeline using read-only platform calls", async () => {
    const response = await probe();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toMatchObject({
      schema_version: 1,
      checks: {
        inquiry_core: { state: "UP" },
        mail_delivery: { state: "UNKNOWN", failed: null, oldest_queued_seconds: null },
        turnstile: { state: "UP", configured: true },
      },
    });
    expect(Number.isFinite(Date.parse(body.checked_at))).toBe(true);
    expect(calls).toEqual(["project"]);
  });

  it("reports the platform as down when it refuses or does not answer", async () => {
    answers.project = async () => ({ ok: false, error: { code: "UNAVAILABLE", message: "down" } });
    expect((await (await probe()).json()).checks.inquiry_core.state).toBe("DOWN");
    answers.project = async () => {
      throw new Error("binding exploded");
    };
    expect((await (await probe()).json()).checks.inquiry_core.state).toBe("DOWN");
  });

  it("is UNKNOWN, not DOWN, when the binding is not configured", async () => {
    const body = await (await probe({ bound: false })).json();
    expect(body.checks.inquiry_core.state).toBe("UNKNOWN");
    expect(body.checks.mail_delivery).toEqual({
      state: "UNKNOWN",
      failed: null,
      oldest_queued_seconds: null,
    });
  });

  it("says delivery is unknown until the SDK can report it, never 'fine'", async () => {
    const text = await (await probe()).text();
    expect(JSON.parse(text).checks.mail_delivery).toEqual({
      state: "UNKNOWN",
      failed: null,
      oldest_queued_seconds: null,
    });
    expect(calls).not.toContain("listDeliveryJobs");
  });

  it("treats a missing Turnstile secret as a closed form", async () => {
    const body = await (await probe({ env: { TURNSTILE_SECRET_KEY: undefined } })).json();
    expect(body.checks.turnstile).toEqual({ state: "DOWN", configured: false });
  });

  it("is rate limited when the limiter says so", async () => {
    const limiter = { limit: async () => ({ success: false }) };
    const response = await probe({
      env: { STATUS_PROBE_RATE_LIMITER: limiter as unknown as RateLimit },
    });
    expect(response.status).toBe(429);
    expect(calls).toEqual([]);
  });
});
