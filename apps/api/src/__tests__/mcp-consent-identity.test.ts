import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  WorkerEntrypoint: class {
    readonly mocked = true;
  },
}));
vi.mock("../access.js", () => ({
  verifyAccessJwt: vi.fn(),
}));

import { McpConsentIdentity } from "../index.js";
import { verifyAccessJwt } from "../access.js";
import type { Env } from "../env.js";

const TEAM = "tomoki-ttttt.cloudflareaccess.com";
const CONSENT_AUD = "dedicated-consent-audience";

function entrypoint(caller = "tomokichi-diary-mcp", envOverrides: Partial<Env> = {}) {
  const entry = Object.create(McpConsentIdentity.prototype) as McpConsentIdentity;
  Object.assign(entry, {
    ctx: { props: { caller } },
    env: {
      ACCESS_TEAM_DOMAIN: TEAM,
      ACCESS_AUD: "admin-audience-must-not-be-used",
      MCP_CONSENT_ACCESS_AUD: CONSENT_AUD,
      ...envOverrides,
    },
  });
  return entry;
}

describe("MCP consent identity entrypoint", () => {
  beforeEach(() => vi.mocked(verifyAccessJwt).mockReset());

  it("requires its Service Binding caller and a dedicated verified Access identity", async () => {
    vi.mocked(verifyAccessJwt).mockResolvedValue({ subject: "owner", email: "owner@example.com" });
    const valid = await entrypoint().fetch(
      new Request("https://internal/mcp-consent-identity", {
        headers: { "cf-access-jwt-assertion": "signed-consent-jwt" },
      }),
    );
    expect(valid.status).toBe(200);
    expect(await valid.json()).toEqual({ subject: "owner" });
    expect(verifyAccessJwt).toHaveBeenCalledWith("signed-consent-jwt", TEAM, CONSENT_AUD);

    const wrongCaller = await entrypoint("untrusted-worker").fetch(
      new Request("https://internal/mcp-consent-identity", {
        headers: { "cf-access-jwt-assertion": "signed-consent-jwt" },
      }),
    );
    expect(wrongCaller.status).toBe(403);
    expect(verifyAccessJwt).toHaveBeenCalledTimes(1);
  });

  it("fails closed for missing, invalid or unconfigured assertions", async () => {
    vi.mocked(verifyAccessJwt).mockResolvedValue(null);
    expect(
      (await entrypoint().fetch(new Request("https://internal/mcp-consent-identity"))).status,
    ).toBe(401);
    expect(
      (
        await entrypoint().fetch(
          new Request("https://internal/mcp-consent-identity", {
            headers: { "cf-access-jwt-assertion": "invalid" },
          }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await entrypoint("tomokichi-diary-mcp", { MCP_CONSENT_ACCESS_AUD: "" }).fetch(
          new Request("https://internal/mcp-consent-identity", {
            headers: { "cf-access-jwt-assertion": "signed" },
          }),
        )
      ).status,
    ).toBe(401);
  });
});
