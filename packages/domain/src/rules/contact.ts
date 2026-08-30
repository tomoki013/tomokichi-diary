import type { ContactMessage } from "../entities/contact-message.js";
import { isAfterOrEqual, type Instant } from "../primitives/datetime.js";
import { err, ok, type DomainError, type Result } from "../primitives/result.js";

export interface ContactSubmission {
  readonly name: string;
  readonly email: string;
  readonly subject: string;
  readonly body: string;
}

const LIMITS = { name: 100, email: 254, subject: 150, body: 4000 } as const;
const MIN_BODY = 10;

// Deliberately permissive: the goal is to catch a typo, not to adjudicate what
// a valid address looks like.
const EMAIL_RE = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;

/** Cheap signals that a submission came from a bot rather than a reader. */
const SPAM_MARKERS = [/\[url=/i, /<a\s+href=/i, /\b(?:viagra|casino|crypto\s*giveaway)\b/i];

export function validateContactSubmission(input: ContactSubmission): readonly DomainError[] {
  const errors: DomainError[] = [];
  const fail = (message: string, field: string): void => {
    errors.push({ code: "API_VALIDATION_FAILED", message, field });
  };

  if (input.name.trim() === "") fail("お名前を入力してください", "name");
  else if (input.name.length > LIMITS.name)
    fail(`お名前は${LIMITS.name}文字以内で入力してください`, "name");

  if (!EMAIL_RE.test(input.email.trim())) fail("メールアドレスの形式が正しくありません", "email");
  else if (input.email.length > LIMITS.email) fail("メールアドレスが長すぎます", "email");

  if (input.subject.trim() === "") fail("件名を入力してください", "subject");
  else if (input.subject.length > LIMITS.subject)
    fail(`件名は${LIMITS.subject}文字以内で入力してください`, "subject");

  const body = input.body.trim();
  if (body.length < MIN_BODY)
    fail(`お問い合わせ内容は${MIN_BODY}文字以上で入力してください`, "body");
  else if (body.length > LIMITS.body)
    fail(`お問い合わせ内容は${LIMITS.body}文字以内で入力してください`, "body");

  return errors;
}

/** Marked rather than rejected, so a false positive is still readable in the admin. */
export function looksLikeSpam(input: ContactSubmission): boolean {
  const haystack = `${input.subject}\n${input.body}`;
  const links = (haystack.match(/https?:\/\//g) ?? []).length;
  return links > 3 || SPAM_MARKERS.some((marker) => marker.test(haystack));
}

export const MIN_SECONDS_BETWEEN_SUBMISSIONS = 60;

/** One submission per sender per minute; anything faster is not a person typing. */
export function isRateLimited(previous: ContactMessage | null, now: Instant): boolean {
  if (previous === null) return false;
  const allowedFrom = new Date(
    Date.parse(previous.createdAt) + MIN_SECONDS_BETWEEN_SUBMISSIONS * 1000,
  ).toISOString() as Instant;
  return !isAfterOrEqual(now, allowedFrom);
}

export function acceptContactSubmission(params: {
  input: ContactSubmission;
  previous: ContactMessage | null;
  now: Instant;
}): Result<ContactSubmission> {
  const errors = validateContactSubmission(params.input);
  if (errors.length > 0) return err<ContactSubmission>(...errors);
  if (isRateLimited(params.previous, params.now)) {
    return err({ code: "API_CONFLICT", message: "しばらく時間をおいてから再度お試しください" });
  }
  return ok(params.input);
}
