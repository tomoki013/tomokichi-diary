import { describe, it, expect, vi } from "vitest";
vi.mock("cloudflare:workers", () => ({
  WorkerEntrypoint: class {
    fetch() {}
  },
}));
import { analyticsOAuth, ANALYTICS_RESOURCE, type AnalyticsEnv } from "../analytics-auth";
import {
  authorizedOperator,
  isOperatorPath,
  operatorConsent,
  operatorFetch,
  OPERATOR_ISSUER,
  OPERATOR_RESOURCE,
  type OperatorEnv,
} from "../operator-auth";

const subject = "owner";
const origin = new URL(OPERATOR_RESOURCE).origin;
const redirectUri = "https://chatgpt.com/connector_platform/oauth/callback";
const context = {
  props: {},
  waitUntil() {},
  passThroughOnException() {},
} as unknown as ExecutionContext;

function fixture() {
  const records = new Map<string, string>();
  const adminCalls: Request[] = [];
  const env = {
    OPERATOR_OWNER_SUBJECT: subject,
    ANALYTICS_OWNER_SUBJECT: subject,
    API: { fetch: vi.fn(async () => Response.json({ subject })) },
    OPERATOR_API: {
      fetch: vi.fn(async (request: Request) => {
        adminCalls.push(request);
        return Response.json({ items: [{ id: "a1", title: "京都" }] });
      }),
    },
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
  } as unknown as OperatorEnv & AnalyticsEnv;
  return { env, records, adminCalls };
}

const send = (env: OperatorEnv, url: string, init?: RequestInit) =>
  operatorFetch(new Request(url, init), env, context);

/** Registers a client and runs consent → PKCE code exchange, granting `decision`. */
async function connect(env: OperatorEnv, decision: "read" | "write") {
  const registered = await send(env, `${OPERATOR_ISSUER}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Private test client",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  expect(registered.status).toBe(201);
  const { client_id } = (await registered.json()) as { client_id: string };
  const verifier = "abcdefghijklmnopqrstuvwxyz0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const query = new URLSearchParams({
    client_id,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: "operator:read",
    resource: OPERATOR_RESOURCE,
    state: "private-state",
    code_challenge: Buffer.from(digest).toString("base64url"),
    code_challenge_method: "S256",
  });
  const page = await send(env, `https://admin.tomokichidiary.com/operator-connect?${query}`, {
    headers: { "cf-access-jwt-assertion": "signed" },
  });
  expect(page.status).toBe(200);
  const handle = (await page.text()).match(/name="handle" value="([^"]+)"/)?.[1];
  const post = await send(env, "https://admin.tomokichidiary.com/operator-connect", {
    method: "POST",
    headers: {
      "cf-access-jwt-assertion": "signed",
      origin: "https://admin.tomokichidiary.com",
      cookie: page.headers.get("set-cookie")!.split(";")[0]!,
    },
    body: new URLSearchParams({ handle: handle!, decision }),
  });
  expect(post.status).toBe(303);
  const redirect = new URL(post.headers.get("location")!);
  expect(redirect.searchParams.get("iss")).toBe(OPERATOR_ISSUER);
  const exchange = await send(env, `${OPERATOR_ISSUER}/oauth/token`, {
    method: "POST",
    body: new URLSearchParams({
      client_id,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code: redirect.searchParams.get("code")!,
      code_verifier: verifier,
      resource: OPERATOR_RESOURCE,
    }),
  });
  expect(exchange.status).toBe(200);
  return ((await exchange.json()) as { access_token: string }).access_token;
}

const rpc = (env: OperatorEnv, token: string, body: unknown) =>
  send(env, OPERATOR_RESOURCE, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      host: new URL(origin).hostname,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...(body as object) }),
  });

/** Tool names from a tools/list reply; descriptions may mention other tools. */
async function toolNames(env: OperatorEnv, token: string) {
  const text = await (await rpc(env, token, { method: "tools/list" })).text();
  const data = text.split("\n").find((line) => line.startsWith("data: "))!;
  return (JSON.parse(data.slice(6)) as { result: { tools: { name: string }[] } }).result.tools.map(
    (tool) => tool.name,
  );
}

describe("remote operator authorization", () => {
  it("routes only operator paths here, leaving analytics untouched", () => {
    expect(isOperatorPath("/operator/mcp")).toBe(true);
    expect(isOperatorPath("/operator-connect")).toBe(true);
    expect(isOperatorPath("/.well-known/oauth-authorization-server/operator")).toBe(true);
    expect(isOperatorPath("/.well-known/oauth-protected-resource/operator/mcp")).toBe(true);
    expect(isOperatorPath("/analytics/mcp")).toBe(false);
    expect(isOperatorPath("/analytics-connect")).toBe(false);
    expect(isOperatorPath("/.well-known/oauth-authorization-server")).toBe(false);
  });

  it("challenges anonymous calls toward its own metadata and never reaches the API", async () => {
    const { env } = fixture();
    for (const authorization of [undefined, "Bearer fake-token"]) {
      const response = await send(env, OPERATOR_RESOURCE, {
        method: "POST",
        headers: authorization ? { authorization } : {},
      });
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain(
        `${origin}/.well-known/oauth-protected-resource/operator/mcp`,
      );
    }
    expect(env.OPERATOR_API!.fetch).not.toHaveBeenCalled();
  });

  it("publishes a separate issuer with read/write scopes and the Access-protected consent page", async () => {
    const { env } = fixture();
    const resource = (await (
      await send(env, `${origin}/.well-known/oauth-protected-resource/operator/mcp`)
    ).json()) as Record<string, unknown>;
    expect(resource.resource).toBe(OPERATOR_RESOURCE);
    expect(resource.authorization_servers).toEqual([OPERATOR_ISSUER]);
    expect(resource.scopes_supported).toEqual(["operator:read"]);
    const server = (await (
      await send(env, `${origin}/.well-known/oauth-authorization-server/operator`)
    ).json()) as Record<string, unknown>;
    expect(server.issuer).toBe(OPERATOR_ISSUER);
    expect(server.authorization_endpoint).toBe("https://admin.tomokichidiary.com/operator-connect");
    expect(server.token_endpoint).toBe(`${OPERATOR_ISSUER}/oauth/token`);
    expect(server.scopes_supported).toEqual(["operator:read", "operator:write", "offline_access"]);
    expect(server.code_challenge_methods_supported).toEqual(["S256"]);
  });

  it("pins the owner and read scope, and closes when the owner secret is removed", () => {
    const { env } = fixture();
    expect(authorizedOperator(env, { subject }, ["operator:read"])).toBe(true);
    expect(authorizedOperator(env, { subject: "someone" }, ["operator:read"])).toBe(false);
    expect(authorizedOperator(env, { subject }, ["analytics:read"])).toBe(false);
    expect(
      authorizedOperator({ ...env, OPERATOR_OWNER_SUBJECT: undefined }, { subject }, [
        "operator:read",
      ]),
    ).toBe(false);
  });

  it("serves consent only on the admin host to the verified owner, same-origin", async () => {
    const { env } = fixture();
    expect((await operatorConsent(new Request(`${origin}/operator-connect`), env)).status).toBe(
      404,
    );
    expect(
      (await operatorConsent(new Request("https://admin.tomokichidiary.com/operator-connect"), env))
        .status,
    ).toBe(403);
    const crossOrigin = new Request("https://admin.tomokichidiary.com/operator-connect", {
      method: "POST",
      headers: { "cf-access-jwt-assertion": "signed", origin: "https://evil.example" },
    });
    expect((await operatorConsent(crossOrigin, env)).status).toBe(403);
    const otherPerson = {
      ...env,
      API: { fetch: async () => Response.json({ subject: "someone" }) },
    };
    expect(
      (
        await operatorConsent(
          new Request("https://admin.tomokichidiary.com/operator-connect", {
            headers: { "cf-access-jwt-assertion": "signed" },
          }),
          otherPerson,
        )
      ).status,
    ).toBe(403);
  });
});

describe("remote operator tools", () => {
  it("lists only read tools for a read grant and calls the admin API without any token", async () => {
    const { env, records, adminCalls } = fixture();
    const token = await connect(env, "read");
    expect([...records.keys()].every((key) => key.startsWith("operator:"))).toBe(true);
    const names = await toolNames(env, token);
    expect(names).toContain("list_articles");
    expect(names).toContain("check_publishable");
    expect(names).not.toContain("save_article_draft");
    expect(names).not.toContain("publish_article");
    const called = await rpc(env, token, {
      method: "tools/call",
      params: { name: "list_articles", arguments: {} },
    });
    expect(await called.text()).toContain("京都");
    expect(adminCalls).toHaveLength(1);
    expect(new URL(adminCalls[0]!.url).pathname).toBe("/v1/admin/articles");
    expect(adminCalls[0]!.headers.get("authorization")).toBeNull();
  });

  it("lists write tools for a write grant, still requiring the publish confirmation", async () => {
    const { env, adminCalls } = fixture();
    const token = await connect(env, "write");
    const names = await toolNames(env, token);
    expect(names).toContain("save_article_draft");
    expect(names).toContain("publish_article");
    expect(names.some((name) => name.startsWith("delete_"))).toBe(false);
    const refused = await rpc(env, token, {
      method: "tools/call",
      params: { name: "publish_article", arguments: { articleId: "a1", confirmArticleId: "a2" } },
    });
    expect(await refused.text()).toContain("confirmArticleId");
    expect(adminCalls).toHaveLength(0);
  });

  it("refuses its tokens at the analytics resource and closes when the owner secret is gone", async () => {
    const { env } = fixture();
    const token = await connect(env, "read");
    const atAnalytics = await analyticsOAuth.fetch(
      new Request(ANALYTICS_RESOURCE, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      }),
      env as unknown as AnalyticsEnv,
      context,
    );
    expect(atAnalytics.status).toBe(401);
    const closed = await rpc({ ...env, OPERATOR_OWNER_SUBJECT: undefined }, token, {
      method: "tools/list",
    });
    expect(closed.status).toBe(403);
  });
});
