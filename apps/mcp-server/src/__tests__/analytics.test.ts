import { describe, it, expect, vi } from "vitest";
vi.mock("cloudflare:workers", () => ({
  WorkerEntrypoint: class {
    fetch() {}
  },
}));
import {
  analyticsOAuth,
  ANALYTICS_RESOURCE,
  authorizedOwner,
  consent,
  escapeHtml,
  type AnalyticsEnv,
} from "../analytics-auth";
import { completedRange } from "../analytics-server";

const subject = "owner";
const context = {
  props: {},
  waitUntil() {},
  passThroughOnException() {},
} as unknown as ExecutionContext;
function fixture() {
  const records = new Map<string, string>();
  const env = {
    ANALYTICS_OWNER_SUBJECT: subject,
    API: { fetch: vi.fn(async () => Response.json({ subject })) },
    OAUTH_KV: {
      get: async (key: string, kind?: string | { type: string }) => {
        const v = records.get(key);
        return v === undefined
          ? null
          : kind === "json" || (typeof kind === "object" && kind.type === "json")
            ? JSON.parse(v)
            : v;
      },
      put: async (key: string, value: string) => {
        records.set(key, value);
      },
      delete: async (key: string) => {
        records.delete(key);
      },
      list: async ({ prefix = "" } = {}) => ({
        keys: [...records.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })),
        list_complete: true,
        cursor: "",
      }),
    },
  } as unknown as AnalyticsEnv;
  return { env, records };
}
describe("private analytics authorization", () => {
  it("rejects anonymous, invalid and out-of-resource tokens with no database access", async () => {
    const { env } = fixture();
    for (const authorization of [undefined, "Bearer fake-token"]) {
      const response = await analyticsOAuth.fetch(
        new Request(ANALYTICS_RESOURCE, { headers: authorization ? { authorization } : {} }),
        env,
        context,
      );
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain("oauth-protected-resource");
      expect(await response.text()).not.toContain("estimatedEarnings");
    }
  });
  it("pins both the human owner and analytics read scope, and closes when configuration is missing", () => {
    const { env } = fixture();
    expect(authorizedOwner(env, { subject }, ["analytics:read"])).toBe(true);
    expect(authorizedOwner(env, { subject: "another-user" }, ["analytics:read"])).toBe(false);
    expect(authorizedOwner(env, { subject }, ["article:write"])).toBe(false);
    expect(
      authorizedOwner({ ...env, ANALYTICS_OWNER_SUBJECT: undefined }, { subject }, [
        "analytics:read",
      ]),
    ).toBe(false);
  });
  it("never serves consent from the public host or from an unverified identity; rejects cross-origin POST", async () => {
    const { env } = fixture();
    expect((await consent(new Request(`${ANALYTICS_RESOURCE}/../authorize`), env)).status).toBe(
      404,
    );
    expect(
      (await consent(new Request("https://admin.tomokichidiary.com/analytics-connect"), env))
        .status,
    ).toBe(403);
    const request = new Request("https://admin.tomokichidiary.com/analytics-connect", {
      method: "POST",
      headers: { "cf-access-jwt-assertion": "signed", origin: "https://evil.example" },
    });
    expect((await consent(request, env)).status).toBe(403);
    expect(
      (
        await consent(
          new Request("https://admin.tomokichidiary.com/analytics-connect", {
            method: "POST",
            headers: { "cf-access-jwt-assertion": "signed", origin: "null" },
          }),
          env,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await consent(request, {
          ...env,
          API: { fetch: async () => Response.json({ subject: "another-user" }) },
        })
      ).status,
    ).toBe(403);
  });
  it("escapes untrusted client names and displays the destination, read scope and token lifetime", async () => {
    const { env } = fixture();
    const auth = { scope: ["analytics:read"] };
    env.OAUTH_PROVIDER = {
      parseAuthRequest: vi.fn(async () => auth),
      describeConsent: vi.fn(async () => ({
        clientName: '<script>alert("x")</script>',
        redirectHost: "chatgpt.com",
        redirectUri: "https://chatgpt.com/connector_platform_oauth_redirect",
      })),
      beginConsent: vi.fn(async () => ({ handle: '"bad', headers: new Headers() })),
    } as unknown as AnalyticsEnv["OAUTH_PROVIDER"];
    const response = await consent(
      new Request("https://admin.tomokichidiary.com/analytics-connect", {
        headers: { "cf-access-jwt-assertion": "signed" },
      }),
      env,
    );
    const html = await response.text();
    expect(html).not.toContain("<script>");
    expect(html).toContain(escapeHtml('<script>alert("x")</script>'));
    expect(html).toContain("chatgpt.com");
    expect(html).toContain("analytics:read");
    expect(html).toContain("90日");
    expect(response.headers.get("referrer-policy")).toBe("same-origin");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("content-security-policy")).toContain(
      "form-action 'self' https://chatgpt.com;",
    );
    expect(response.headers.get("content-security-policy")).not.toContain("form-action *");
  });
  it("advertises one read scope, PKCE and the Access-protected consent page", async () => {
    const { env } = fixture();
    const response = await analyticsOAuth.fetch(
      new Request(
        "https://tomokichi-diary-mcp.tomoki-ttttt.workers.dev/.well-known/oauth-authorization-server",
      ),
      env,
      context,
    );
    const data = (await response.json()) as Record<string, unknown>;
    expect(data.authorization_endpoint).toBe("https://admin.tomokichidiary.com/analytics-connect");
    expect(data.scopes_supported).toEqual(["analytics:read", "offline_access"]);
    expect(data.code_challenge_methods_supported).toEqual(["S256"]);
  });
});
it("uses completed Japanese calendar periods at week/month/year boundaries", () => {
  expect(completedRange("weekly", new Date("2026-10-11T15:00:00Z"))).toEqual({
    start: "2026-10-05",
    end: "2026-10-11",
  });
  expect(completedRange("weekly", new Date("2026-10-10T15:00:00Z"))).toEqual({
    start: "2026-09-28",
    end: "2026-10-04",
  });
  expect(completedRange("monthly", new Date("2026-12-31T15:00:00Z"))).toEqual({
    start: "2026-12-01",
    end: "2026-12-31",
  });
});

it("completes owner consent → PKCE → authenticated read-only tools, rejects code replay and wrong token audience", async () => {
  const { env } = fixture();
  const origin = new URL(ANALYTICS_RESOURCE).origin;
  const send = (path: string, init?: RequestInit) =>
    analyticsOAuth.fetch(new Request(`${origin}${path}`, init), env, context);
  const clientResponse = await send("/analytics/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Private test client",
      redirect_uris: ["https://chatgpt.com/connector_platform/oauth/callback"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  expect(clientResponse.status).toBe(201);
  const client = (await clientResponse.json()) as { client_id: string };
  const verifier = "abcdefghijklmnopqrstuvwxyz0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = Buffer.from(digest).toString("base64url");
  const query = new URLSearchParams({
    client_id: client.client_id,
    response_type: "code",
    redirect_uri: "https://chatgpt.com/connector_platform/oauth/callback",
    scope: "analytics:read",
    resource: ANALYTICS_RESOURCE,
    state: "private-state",
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  const page = await analyticsOAuth.fetch(
    new Request(`https://admin.tomokichidiary.com/analytics-connect?${query}`, {
      headers: { "cf-access-jwt-assertion": "signed" },
    }),
    env,
    context,
  );
  expect(page.status).toBe(200);
  const handle = (await page.text()).match(/name="handle" value="([^"]+)"/)?.[1];
  expect(handle).toBeTruthy();
  const cookie = page.headers.get("set-cookie")!.split(";")[0]!;
  const post = await analyticsOAuth.fetch(
    new Request("https://admin.tomokichidiary.com/analytics-connect", {
      method: "POST",
      headers: {
        "cf-access-jwt-assertion": "signed",
        origin: "https://admin.tomokichidiary.com",
        cookie,
      },
      body: new URLSearchParams({ handle: handle!, decision: "allow" }),
    }),
    env,
    context,
  );
  expect(post.status).toBe(303);
  const redirect = new URL(post.headers.get("location")!);
  expect(redirect.searchParams.get("state")).toBe("private-state");
  expect(redirect.searchParams.get("iss")).toBe(origin);
  const body = new URLSearchParams({
    client_id: client.client_id,
    grant_type: "authorization_code",
    redirect_uri: "https://chatgpt.com/connector_platform/oauth/callback",
    code: redirect.searchParams.get("code")!,
    code_verifier: verifier,
    resource: ANALYTICS_RESOURCE,
  });
  const exchange = await send("/analytics/oauth/token", { method: "POST", body });
  expect(exchange.status).toBe(200);
  const tokens = (await exchange.json()) as { access_token: string; refresh_token: string };
  expect(tokens.refresh_token).toBeTruthy();
  const list = await send("/analytics/mcp", {
    method: "POST",
    headers: {
      authorization: `Bearer ${tokens.access_token}`,
      host: new URL(origin).hostname,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  expect(list.status).toBe(200);
  const text = await list.text();
  expect(text).toContain("get_analytics_report");
  expect(text).toContain("get_analytics_dashboard");
  expect(text).not.toContain("recalculate");
  env.DB = {
    prepare: () => ({
      bind() {
        return this;
      },
      all: async () => ({ results: [] }),
      first: async () => null,
    }),
  } as unknown as AnalyticsEnv["DB"];
  const report = await send("/analytics/mcp", {
    method: "POST",
    headers: {
      authorization: `Bearer ${tokens.access_token}`,
      host: new URL(origin).hostname,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "get_analytics_report", arguments: { period: "weekly" } },
    }),
  });
  expect(report.status).toBe(200);
  const reportText = await report.text();
  expect(reportText).toContain("not_generated");
  expect(reportText).toContain("coveredDays");
  expect(reportText).not.toContain("cf-access-jwt");
  expect(reportText).not.toContain(tokens.access_token);
  const refreshed = await send("/analytics/oauth/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: client.client_id,
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      resource: ANALYTICS_RESOURCE,
    }),
  });
  expect(refreshed.status).toBe(200);
  const refreshedTokens = (await refreshed.json()) as { refresh_token: string };
  const wrongResource = new URLSearchParams({
    client_id: client.client_id,
    grant_type: "refresh_token",
    refresh_token: refreshedTokens.refresh_token,
    resource: `${origin}/mcp`,
  });
  expect(
    (await send("/analytics/oauth/token", { method: "POST", body: wrongResource })).status,
  ).toBe(400);
  expect((await send("/analytics/oauth/token", { method: "POST", body })).status).toBe(400);
});
