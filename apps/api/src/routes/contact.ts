import { Hono } from "hono";
import { submitContactMessage } from "@tomokichi/application";
import type { AppEnv } from "../app.js";
import { errorResponse } from "../http.js";

/**
 * The only unauthenticated write in the system.
 *
 * It is a plain form POST so the contact page needs no JavaScript to submit,
 * and the response is a redirect back to the site — the browser never sees the
 * API origin in the address bar.
 */
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

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

  const response = await fetch(TURNSTILE_VERIFY_URL, { method: "POST", body });
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

/** A salted hash: enough to rate-limit a sender, not enough to identify one. */
async function hashIp(ip: string, salt: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${ip}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function contactRoutes() {
  const routes = new Hono<AppEnv>();

  routes.post("/", async (c) => {
    const siteUrl = (c.env.PUBLIC_SITE_URL ?? "https://tomokichidiary.com").replace(/\/+$/, "");
    const back = (query: string): Response => c.redirect(`${siteUrl}/contact${query}`, 303);

    const secret = c.env.TURNSTILE_SECRET_KEY;
    const salt = c.env.IP_HASH_SALT;
    if (!secret || !salt) {
      // Fail closed: an unconfigured form accepts nothing rather than
      // accepting everything.
      c.get("ctx").logger.error("contact.not_configured", { code: "API_INTERNAL" });
      return errorResponse(c, "API_INTERNAL", "contact form is not configured", 500);
    }

    const form = await c.req.formData().catch(() => null);
    if (form === null) return back("?error=invalid");

    // Honeypot: a field no person sees, so anything that fills it is automated.
    if (String(form.get("website") ?? "") !== "") {
      c.get("ctx").logger.warn("contact.honeypot", {});
      return back("?sent=1");
    }

    const ip = c.req.header("cf-connecting-ip") ?? undefined;
    const token = String(form.get("cf-turnstile-response") ?? "");
    if (
      token === "" ||
      !(await c.get("verifyChallenge")(
        secret,
        token,
        ip,
        c.env.TURNSTILE_EXPECTED_HOSTNAME?.trim(),
      ))
    ) {
      return back("?error=challenge");
    }

    const result = await submitContactMessage(c.get("ctx"), {
      name: String(form.get("name") ?? ""),
      email: String(form.get("email") ?? ""),
      subject: String(form.get("subject") ?? ""),
      body: String(form.get("body") ?? ""),
      ipHash: await hashIp(ip ?? "unknown", salt),
    });

    if (!result.ok) {
      const first = result.errors[0];
      return back(`?error=${first?.code === "API_CONFLICT" ? "toofast" : "invalid"}`);
    }
    return back("?sent=1");
  });

  return routes;
}
