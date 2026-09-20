import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { verifyAccessJwt } from "../access.js";

/*
 * Why this exists: `verifyAccessJwt` is the defence-in-depth behind Cloudflare
 * Access — the check that keeps admin endpoints closed if a request ever
 * reaches the Worker by a path Access does not cover. It had no tests, so the
 * claim in docs/OPERATIONS.md ("verified against the team's public keys") was
 * unverified. Everything here runs offline: an RSA key pair is generated once,
 * the certificate endpoint is stubbed, and time is fixed.
 */

const TEAM = "team.cloudflareaccess.com";
const AUD = "aud-1234";
const KID = "kid-1";
const NOW = 1_800_000_000; // seconds

let privateKey: CryptoKey;
let jwk: JsonWebKey & { kid: string };

const base64url = (bytes: Uint8Array | string): string => {
  const raw = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  return btoa(String.fromCharCode(...raw))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
};

async function mint(
  claims: Record<string, unknown>,
  options: { kid?: string; alg?: string; tamper?: boolean } = {},
): Promise<string> {
  const header = base64url(
    JSON.stringify({ alg: options.alg ?? "RS256", kid: options.kid ?? KID }),
  );
  const payload = base64url(
    JSON.stringify({ aud: AUD, iss: `https://${TEAM}`, exp: NOW + 600, iat: NOW, ...claims }),
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      privateKey,
      new TextEncoder().encode(`${header}.${payload}`),
    ),
  );
  if (options.tamper) signature[0] = (signature[0]! + 1) & 0xff;
  return `${header}.${payload}.${base64url(signature)}`;
}

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  privateKey = pair.privateKey;
  const exported = await crypto.subtle.exportKey("jwk", pair.publicKey);
  jwk = { kty: exported.kty!, n: exported.n!, e: exported.e!, alg: "RS256", use: "sig", kid: KID };

  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url === `https://${TEAM}/cdn-cgi/access/certs`) {
      return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
    }
    return new Response("unexpected fetch", { status: 500 });
  });
  vi.useFakeTimers();
  vi.setSystemTime(NOW * 1000);
});

afterEach(() => {
  vi.setSystemTime(NOW * 1000);
});

describe("verifyAccessJwt", () => {
  it("returns the identity for a token signed by the team's key", async () => {
    const identity = await verifyAccessJwt(
      await mint({ email: "owner@example.com", sub: "sub-1" }),
      TEAM,
      AUD,
    );
    expect(identity).toEqual({ email: "owner@example.com", subject: "sub-1" });
  });

  it("rejects a token for another application or another team", async () => {
    expect(await verifyAccessJwt(await mint({ aud: "other" }), TEAM, AUD)).toBeNull();
    expect(
      await verifyAccessJwt(await mint({ iss: "https://evil.example" }), TEAM, AUD),
    ).toBeNull();
  });

  it("rejects an expired token and one issued in the future", async () => {
    expect(await verifyAccessJwt(await mint({ exp: NOW - 1 }), TEAM, AUD)).toBeNull();
    expect(await verifyAccessJwt(await mint({ iat: NOW + 3600 }), TEAM, AUD)).toBeNull();
    // Session expiry is a real event, not a fixture: a token that was valid
    // stops being valid once the clock passes `exp`.
    const token = await mint({ exp: NOW + 60 });
    expect(await verifyAccessJwt(token, TEAM, AUD)).not.toBeNull();
    vi.setSystemTime((NOW + 61) * 1000);
    expect(await verifyAccessJwt(token, TEAM, AUD)).toBeNull();
  });

  it("rejects a tampered signature, an unknown key id and a non-RS256 header", async () => {
    expect(await verifyAccessJwt(await mint({}, { tamper: true }), TEAM, AUD)).toBeNull();
    expect(await verifyAccessJwt(await mint({}, { kid: "kid-unknown" }), TEAM, AUD)).toBeNull();
    expect(await verifyAccessJwt(await mint({}, { alg: "none" }), TEAM, AUD)).toBeNull();
    expect(await verifyAccessJwt(await mint({}, { alg: "HS256" }), TEAM, AUD)).toBeNull();
  });

  it("rejects malformed input without throwing", async () => {
    for (const token of ["", "a.b", "a.b.c", "not.a.jwt.at.all", ".."]) {
      expect(await verifyAccessJwt(token, TEAM, AUD)).toBeNull();
    }
  });
});
