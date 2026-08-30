/**
 * Verifies the identity token Cloudflare Access puts on every request it lets
 * through.
 *
 * Access already blocks unauthorised traffic at the edge, so this is defence in
 * depth: it means a request that reaches the Worker by some other path — a
 * workers.dev URL, a misconfigured route — still cannot touch admin endpoints.
 */
export interface AccessIdentity {
  readonly email: string;
  readonly subject: string;
}

interface JsonWebKey {
  kid: string;
  kty: string;
  alg: string;
  use?: string;
  n: string;
  e: string;
}

/** Keys are stable for hours; refetching per request would add a hop to every call. */
const KEY_CACHE_TTL_MS = 60 * 60 * 1000;
const keyCache = new Map<string, { keys: JsonWebKey[]; fetchedAt: number }>();

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.codePointAt(0)!);
}

function decodeSegment<T>(segment: string): T | null {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment))) as T;
  } catch {
    return null;
  }
}

async function certificates(teamDomain: string): Promise<JsonWebKey[]> {
  const cached = keyCache.get(teamDomain);
  if (cached && Date.now() - cached.fetchedAt < KEY_CACHE_TTL_MS) return cached.keys;

  const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!response.ok) return cached?.keys ?? [];

  const { keys } = (await response.json()) as { keys?: JsonWebKey[] };
  const fetched = keys ?? [];
  if (fetched.length > 0) keyCache.set(teamDomain, { keys: fetched, fetchedAt: Date.now() });
  return fetched;
}

interface AccessClaims {
  aud?: string | string[];
  email?: string;
  sub?: string;
  exp?: number;
  iat?: number;
  iss?: string;
}

/**
 * Returns the verified identity, or null for anything that does not check out.
 * The caller decides what to do about it; this never throws.
 */
export async function verifyAccessJwt(
  token: string,
  teamDomain: string,
  audience: string,
): Promise<AccessIdentity | null> {
  const [headerSegment, payloadSegment, signatureSegment] = token.split(".");
  if (!headerSegment || !payloadSegment || !signatureSegment) return null;

  const header = decodeSegment<{ kid?: string; alg?: string }>(headerSegment);
  const claims = decodeSegment<AccessClaims>(payloadSegment);
  if (!header || !claims || header.alg !== "RS256" || !header.kid) return null;

  const audiences = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
  if (!audiences.includes(audience)) return null;
  if (claims.iss !== `https://${teamDomain}`) return null;

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp <= now) return null;
  if (typeof claims.iat === "number" && claims.iat > now + 60) return null;

  const jwk = (await certificates(teamDomain)).find((candidate) => candidate.kid === header.kid);
  if (!jwk) return null;

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlToBytes(signatureSegment),
    new TextEncoder().encode(`${headerSegment}.${payloadSegment}`),
  );
  if (!verified) return null;

  return { email: claims.email ?? "", subject: claims.sub ?? "" };
}
