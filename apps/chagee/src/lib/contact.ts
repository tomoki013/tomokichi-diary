/** Contact form rules. Pure: the page does the I/O. */

export const CONTACT_KINDS = {
  correction: "情報修正",
  tip: "情報提供",
  question: "お問い合わせ",
  work: "取材・仕事依頼",
  other: "その他",
} as const;
export type ContactKind = keyof typeof CONTACT_KINDS;

export interface ContactInput {
  name: string;
  email: string;
  kind: ContactKind;
  body: string;
  url: string;
}

export type ContactField = keyof ContactInput;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function readContactForm(form: FormData): ContactInput {
  const field = (key: string) => String(form.get(key) ?? "").trim();
  const kind = field("kind");
  return {
    name: field("name"),
    email: field("email"),
    kind: kind in CONTACT_KINDS ? (kind as ContactKind) : "other",
    body: field("body"),
    url: field("url"),
  };
}

/** Field → message, empty when the input is acceptable. */
export function validateContact(input: ContactInput): Partial<Record<ContactField, string>> {
  const errors: Partial<Record<ContactField, string>> = {};
  if (input.name === "") errors.name = "お名前を入力してください";
  else if (input.name.length > 80) errors.name = "お名前は80文字以内で入力してください";
  if (!EMAIL.test(input.email) || input.email.length > 254)
    errors.email = "メールアドレスの形式を確認してください";
  if (input.body.length < 10) errors.body = "内容は10文字以上で入力してください";
  else if (input.body.length > 5000) errors.body = "内容は5000文字以内で入力してください";
  if (input.url !== "") {
    try {
      const parsed = new URL(input.url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("scheme");
    } catch {
      errors.url = "URLは https:// から始まる形で入力してください";
    }
  }
  return errors;
}

/** What the inquiry platform receives: the kind leads the subject, the URL trails the body. */
export function toSubmission(input: ContactInput): { subject: string; message: string } {
  return {
    subject: `[CHAGEEガイド] ${CONTACT_KINDS[input.kind]}`,
    message: input.url === "" ? input.body : `${input.body}\n\n関連URL: ${input.url}`,
  };
}

/** A salted hash: enough to rate-limit a sender, not enough to identify one. Never stored. */
export async function hashIp(ip: string, salt: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${ip}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstile(
  secret: string,
  token: string,
  ip: string | undefined,
  expectedHostnames: string | undefined,
): Promise<boolean> {
  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);
  if (ip !== undefined) body.append("remoteip", ip);
  const response = await fetch(TURNSTILE_VERIFY_URL, { method: "POST", body });
  if (!response.ok) return false;
  const result = (await response.json()) as {
    success?: boolean;
    hostname?: string;
    action?: string;
  };
  const allowed = (expectedHostnames ?? "")
    .split(",")
    .map((hostname) => hostname.trim())
    .filter(Boolean);
  return (
    result.success === true &&
    result.action === "contact" &&
    (allowed.length === 0 || (result.hostname !== undefined && allowed.includes(result.hostname)))
  );
}
