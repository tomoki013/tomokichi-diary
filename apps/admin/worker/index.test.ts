import { expect, it } from "vitest";
import worker from "./index";

it("preserves Access authentication and write bodies through the same-origin proxy", async () => {
  let forwarded: Request | undefined;
  const response = await worker.fetch(
    new Request("https://admin.example/api/v1/admin/articles/a/draft?x=1", {
      method: "PUT",
      headers: {
        "cf-access-jwt-assertion": "identity",
        cookie: "CF_Authorization=session",
        "content-type": "application/json",
      },
      body: '{"title":"saved"}',
    }),
    {
      API: {
        fetch: async (request) => {
          forwarded = request;
          return Response.json({ ok: true });
        },
      },
      ASSETS: { fetch: async () => new Response("incorrect SPA response") },
    },
  );
  expect(new URL(forwarded!.url).pathname).toBe("/v1/admin/articles/a/draft");
  expect(new URL(forwarded!.url).search).toBe("?x=1");
  expect(forwarded!.headers.get("cf-access-jwt-assertion")).toBe("identity");
  expect(await forwarded!.json()).toEqual({ title: "saved" });
  expect(await response.json()).toEqual({ ok: true });
});

it("routes only the private consent page to the MCP binding and preserves the Access assertion and consent cookie", async () => {
  let forwarded: Request | undefined;
  const response = await worker.fetch(
    new Request("https://admin.tomokichidiary.com/analytics-connect", {
      method: "POST",
      headers: {
        "cf-access-jwt-assertion": "identity",
        cookie: "__Host-oauth-consent=session",
        origin: "https://admin.tomokichidiary.com",
      },
      body: "decision=deny&handle=test",
    }),
    {
      ASSETS: { fetch: async () => new Response("SPA") },
      API: { fetch: async () => new Response("API") },
      ANALYTICS_MCP: {
        fetch: async (request) => {
          forwarded = request;
          return new Response("consent");
        },
      },
    },
  );
  expect(await response.text()).toBe("consent");
  expect(forwarded!.url).toBe("https://admin.tomokichidiary.com/analytics-connect");
  expect(forwarded!.headers.get("cf-access-jwt-assertion")).toBe("identity");
  expect(forwarded!.headers.get("cookie")).toBe("__Host-oauth-consent=session");
  expect(await forwarded!.text()).toBe("decision=deny&handle=test");
});
