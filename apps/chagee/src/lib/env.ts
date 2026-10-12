import { env } from "cloudflare:workers";
import type { IntakeBinding } from "@inquiry-platform/sdk";

/** Bindings declared in wrangler.jsonc. Optional ones close a feature when absent. */
export interface GuideEnv {
  DB: D1Database;
  MEDIA: R2Bucket;
  PUBLIC_SITE_URL?: string;
  BLOG_URL?: string;
  /** Contact form: all of these must be set, or the form is shown as closed. */
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_EXPECTED_HOSTNAME?: string;
  IP_HASH_SALT?: string;
  INQUIRY?: IntakeBinding;
  CONTACT_RATE_LIMITER?: RateLimit;
}

export function guideEnv(): GuideEnv {
  return env as unknown as GuideEnv;
}
