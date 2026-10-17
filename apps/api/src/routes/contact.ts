import { Hono, type Context } from "hono";
import { submitContactMessage } from "@tomokichi/application";
import { validateContactSubmission } from "@tomokichi/domain";
import type { AppEnv } from "../app.js";

/**
 * The only unauthenticated write in the system.
 *
 * The contact page submits it with fetch and asks for JSON, so a failure is
 * shown next to the form — with what was typed still in it — instead of
 * replacing the page. A plain form POST still works and is redirected back to
 * the site with the result in the query string. Either way every outcome,
 * including an unexpected error, ends as one of `ContactResult`; the sender
 * never sees a bare error body from the API origin. What passes the checks here
 * is handed to the shared inquiry platform; this Worker keeps no copy.
 */
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** How long siteverify may take before the submission is given up on. */
const VERIFY_TIMEOUT_MS = 10_000;

export async function verifyTurnstile(
  secret: string,
  token: string,
  ip: string | undefined,
  expectedHostnames?: string,
): Promise<boolean> {
  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);
  body.append("idempotency_key", crypto.randomUUID());
  if (ip !== undefined) body.append("remoteip", ip);

  const response = await fetch(TURNSTILE_VERIFY_URL, {
    method: "POST",
    body,
    signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
  });
  if (!response.ok) return false;
  const result = (await response.json()) as {
    success?: boolean;
    hostname?: string;
    action?: string;
  };
  const allowedHostnames = (expectedHostnames ?? "")
    .split(",")
    .map((hostname) => hostname.trim())
    .filter(Boolean);
  return (
    result.success === true &&
    result.action === "contact" &&
    (allowedHostnames.length === 0 ||
      (result.hostname !== undefined && allowedHostnames.includes(result.hostname)))
  );
}

/** A salted hash: enough to rate-limit a sender, not enough to identify one. Never stored. */
async function hashIp(ip: string, salt: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${ip}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Every way a submission can end; the contact page has one message per result. */
export type ContactResult = "sent" | "challenge" | "invalid" | "toofast" | "unavailable";

const STATUS_BY_RESULT = {
  sent: 200,
  challenge: 400,
  invalid: 400,
  toofast: 429,
  unavailable: 503,
} as const;

export function contactRoutes() {
  const routes = new Hono<AppEnv>();

  routes.post("/", async (c) => {
    let result: ContactResult;
    try {
      result = await handleSubmission(c);
    } catch (error) {
      c.get("ctx").logger.error("contact.failed", {
        code: "API_INTERNAL",
        message: error instanceof Error ? error.message : String(error),
      });
      result = "unavailable";
    }

    if (c.req.header("accept")?.includes("application/json")) {
      return c.json({ result }, STATUS_BY_RESULT[result]);
    }
    const siteUrl = (c.env.PUBLIC_SITE_URL ?? "https://tomokichidiary.com").replace(/\/+$/, "");
    const query = result === "sent" ? "?sent=1" : `?error=${result}`;
    return c.redirect(`${siteUrl}/contact${query}`, 303);
  });

  return routes;
}

async function handleSubmission(c: Context<AppEnv>): Promise<ContactResult> {
  const secret = c.env.TURNSTILE_SECRET_KEY;
  const salt = c.env.IP_HASH_SALT;
  const limiter = c.env.CONTACT_RATE_LIMITER;
  if (!secret || !salt || !limiter) {
    // Fail closed: an unconfigured form accepts nothing rather than
    // accepting everything.
    c.get("ctx").logger.error("contact.not_configured", { code: "API_INTERNAL" });
    return "unavailable";
  }

  const form = await c.req.formData().catch(() => null);
  if (form === null) return "invalid";

  // Honeypot: a field no person sees, so anything that fills it is automated.
  if (String(form.get("website") ?? "") !== "") {
    c.get("ctx").logger.warn("contact.honeypot", {});
    return "sent";
  }

  const ip = c.req.header("cf-connecting-ip") ?? undefined;
  const token = String(form.get("cf-turnstile-response") ?? "");
  if (
    token === "" ||
    !(await c.get("verifyChallenge")(secret, token, ip, c.env.TURNSTILE_EXPECTED_HOSTNAME?.trim()))
  ) {
    return "challenge";
  }

  const submission = {
    name: String(form.get("name") ?? ""),
    email: String(form.get("email") ?? ""),
    subject: String(form.get("subject") ?? ""),
    body: String(form.get("body") ?? ""),
  };
  // Checked before the limiter so fixing a typo does not cost a minute.
  if (validateContactSubmission(submission).length > 0) return "invalid";

  const { success } = await limiter.limit({ key: await hashIp(ip ?? "unknown", salt) });
  if (!success) return "toofast";

  const result = await submitContactMessage(c.get("ctx"), {
    ...submission,
    idempotencyKey: crypto.randomUUID(),
  });

  if (!result.ok) {
    return result.errors[0]?.code === "API_VALIDATION_FAILED" ? "invalid" : "unavailable";
  }
  return "sent";
}
