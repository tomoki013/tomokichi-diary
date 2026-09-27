import type { DomainError } from "../primitives/result.js";

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
