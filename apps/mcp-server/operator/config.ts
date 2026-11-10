/**
 * The local operator's settings. Nothing here is deployed: it runs on the
 * owner's machine and talks to the admin API with a bearer token.
 */
export interface OperatorConfig {
  /** API origin, e.g. http://localhost:8787 (wrangler dev) or https://api.tomokichidiary.com. */
  readonly apiUrl: string;
  readonly token: string;
  /** Write tools are listed only when the owner turned them on for this session. */
  readonly allowWrites: boolean;
}

export class OperatorError extends Error {}

/** Reads the configuration from the environment and refuses to start half-configured. */
export function configFromEnv(env: Record<string, string | undefined>): OperatorConfig {
  const token =
    env["TOMOKICHI_LOCAL_OPERATOR_TOKEN"]?.trim() || env["TOMOKICHI_ADMIN_TOKEN"]?.trim() || "";
  if (token === "")
    throw new OperatorError(
      "Set TOMOKICHI_LOCAL_OPERATOR_TOKEN (preferred) or TOMOKICHI_ADMIN_TOKEN through the MCP client's env, never in a file in the repository.",
    );
  const apiUrl = (env["TOMOKICHI_API_URL"]?.trim() || "http://localhost:8787").replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(apiUrl);
  } catch {
    throw new OperatorError(`TOMOKICHI_API_URL is not a URL: ${apiUrl}`);
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  // The token is a bearer secret: it only ever travels over TLS or loopback.
  if (parsed.protocol !== "https:" && !local)
    throw new OperatorError("TOMOKICHI_API_URL must be https unless it is localhost");
  return { apiUrl, token, allowWrites: env["TOMOKICHI_OPERATOR_WRITE"] === "1" };
}
