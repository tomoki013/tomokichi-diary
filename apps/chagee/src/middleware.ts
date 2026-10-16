import { defineMiddleware } from "astro:middleware";

/**
 * Headers for every response. Pages are rendered per request from D1, so a
 * short shared cache keeps repeat views cheap while edits still show within
 * minutes. Responses that set their own Cache-Control (media, feeds, the
 * contact form) keep it.
 */
const CSP = [
  "default-src 'self'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com",
  "connect-src 'self'",
  "form-action 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join("; ");

export const onRequest = defineMiddleware(async (_context, next) => {
  // Re-wrapped because some responses (redirects, fetched assets) carry immutable headers.
  const original = await next();
  const response = new Response(original.body, original);
  const headers = response.headers;
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if ((headers.get("Content-Type") ?? "").startsWith("text/html")) {
    headers.set("Content-Security-Policy", CSP);
    if (!headers.has("Cache-Control")) {
      headers.set("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=600");
    }
  }
  return response;
});
