import type { D1Like } from "@tomokichi/infra-d1";
import type { R2Like } from "@tomokichi/infra-r2";
import type { IntakeBinding, ProjectOperatorApi } from "@inquiry-platform/sdk";
import type { ContactMailBinding } from "./contact-mail.js";

/**
 * The Worker's bindings and configuration. This is the only place in the API
 * that names a Cloudflare product; everything below the HTTP layer sees the
 * ports instead (instruction §72).
 */
export interface Env {
  DB: D1Like;
  MEDIA: R2Like;
  /** Shared secret for the admin API. Set with `wrangler secret put ADMIN_TOKEN --name tomokichi-diary-api`. */
  ADMIN_TOKEN?: string;
  /** Fine-grained GitHub token: this repository's Actions write permission only. */
  GITHUB_PUBLISH_TOKEN?: string;
  PUBLIC_MEDIA_URL?: string;
  PUBLIC_SITE_URL?: string;
  ALLOWED_ORIGINS?: string;
  /** Turnstile secret for the public contact form. Unset means the form is closed. */
  TURNSTILE_SECRET_KEY?: string;
  /** Optional comma-separated hostnames asserted by Turnstile for contact submissions. */
  TURNSTILE_EXPECTED_HOSTNAME?: string;
  /** Salt for the sender-address hash used to rate-limit the contact form. */
  IP_HASH_SALT?: string;
  /** The inquiry platform's `Intake` entrypoint: where a copy of each contact is kept. */
  INQUIRY?: IntakeBinding;
  /**
   * `send_email`, pinned to the blog's inbox: where each contact is read and
   * answered. The form refuses only when neither this nor `INQUIRY` works.
   */
  CONTACT_MAIL?: ContactMailBinding;
  /** Sender address, on a domain with Email Routing enabled. */
  CONTACT_MAIL_FROM?: string;
  /** The blog's inbox; must equal the binding's verified destination. */
  CONTACT_MAIL_TO?: string;
  /** One contact submission per sender per minute. Unset means the form refuses. */
  CONTACT_RATE_LIMITER?: RateLimit;
  /**
   * The inquiry platform's `ProjectOperator` entrypoint: this site's tickets,
   * for its admin. Unset means the inquiry screen says "not configured".
   */
  INQUIRY_OPERATOR?: ProjectOperatorApi;
  /** Salt used before anonymous like identities are persisted. */
  LIKE_HASH_SALT?: string;
  /** Cloudflare Access team domain, e.g. `example.cloudflareaccess.com`. */
  ACCESS_TEAM_DOMAIN?: string;
  /** Audience tag of the Access application protecting the admin. */
  ACCESS_AUD?: string;
}
