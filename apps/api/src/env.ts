import type { D1Like } from "@tomokichi/infra-d1";
import type { R2Like } from "@tomokichi/infra-r2";

/**
 * The Worker's bindings and configuration. This is the only place in the API
 * that names a Cloudflare product; everything below the HTTP layer sees the
 * ports instead (instruction §72).
 */
export interface Env {
  DB: D1Like;
  MEDIA: R2Like;
  /** Shared secret for the admin API. Set with `wrangler secret put ADMIN_TOKEN`. */
  ADMIN_TOKEN?: string;
  PUBLIC_MEDIA_URL?: string;
  PUBLIC_SITE_URL?: string;
  ALLOWED_ORIGINS?: string;
  /** Turnstile secret for the public contact form. Unset means the form is closed. */
  TURNSTILE_SECRET_KEY?: string;
  /** Salt for the sender-address hash used to rate-limit the contact form. */
  IP_HASH_SALT?: string;
}
