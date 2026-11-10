/** What the MCP Worker tells the API about a call, beside the verified OAuth grant. */

/** A hash of the OAuth client id: enough to tell clients apart, never the id itself. */
export async function clientIdDigest(clientId: string | undefined): Promise<string | undefined> {
  if (!clientId) return undefined;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(clientId));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

/**
 * The tool a JSON-RPC call names, for the audit log. Caller-supplied headers
 * are ignored; the SDK validates the name against the registered tools.
 */
export async function toolNameFromRequest(request: Request): Promise<string | undefined> {
  try {
    const value = (await request.clone().json()) as {
      method?: unknown;
      params?: { name?: unknown };
    };
    if (value.method !== "tools/call" || typeof value.params?.name !== "string") return undefined;
    return /^[A-Za-z0-9_.-]{1,100}$/.test(value.params.name) ? value.params.name : undefined;
  } catch {
    return undefined;
  }
}
