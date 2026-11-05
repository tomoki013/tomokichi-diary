import type { Env } from "./env.js";
import { INQUIRY_PROJECT_SLUG } from "./inquiry.js";

const MAX_BYTES = 64 * 1024;
const json = (status: number, code: string) => Response.json({ code }, { status });

async function boundedBody(request: Request): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** Verify Svix's signature over the original bytes, before parsing anything. */
export async function verifyResendWebhook(
  request: Request,
  body: string,
  secret: string,
  now = Date.now(),
): Promise<boolean> {
  const id = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const signatures = request.headers.get("svix-signature") ?? "";
  if (
    !id ||
    !timestamp ||
    !/^\d+$/.test(timestamp) ||
    Math.abs(now / 1000 - Number(timestamp)) > 300
  )
    return false;
  try {
    const bytes = Uint8Array.from(atob(secret.replace(/^whsec_/, "")), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey(
      "raw",
      bytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const content = new TextEncoder().encode(`${id}.${timestamp}.${body}`);
    for (const value of signatures.split(" ")) {
      const [version, encoded] = value.split(",");
      if (version !== "v1" || !encoded) continue;
      const signature = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
      if (await crypto.subtle.verify("HMAC", key, signature, content)) return true;
    }
  } catch {
    return false;
  }
  return false;
}

/** Only provider IDs cross Intake; recipients, subjects and bodies are discarded. */
export async function resendWebhook(request: Request, env: Env): Promise<Response> {
  const secret = env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secret) return json(404, "NOT_FOUND");
  const body = await boundedBody(request);
  if (body === null) return json(413, "TOO_LARGE");
  if (!(await verifyResendWebhook(request, body, secret))) return json(401, "INVALID_SIGNATURE");
  let event: { type?: string; data?: { email_id?: unknown; message_id?: unknown; from?: unknown } };
  try {
    event = JSON.parse(body);
  } catch {
    return json(400, "INVALID_EVENT");
  }
  if (!event || event.type !== "email.sent") return new Response(null, { status: 204 });
  const from = event.data?.from;
  if (typeof from !== "string") return json(400, "INVALID_EVENT");
  const address = (from.match(/<([^<>]+)>\s*$/)?.[1] ?? from).trim().toLowerCase();
  // The account also sends notifications and other projects' mail. They are
  // not support replies on this project and need no receipt here.
  if (address !== "contact@tomokichidiary.com") return new Response(null, { status: 204 });
  const transportId = event.data?.email_id;
  const messageId = event.data?.message_id;
  if (
    typeof transportId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(transportId) ||
    typeof messageId !== "string" ||
    messageId.length > 998 ||
    !/^<[^<>\s]+@[^<>\s]+>$/.test(messageId)
  )
    return json(400, "INVALID_EVENT");
  if (!env.INQUIRY) return json(503, "UNAVAILABLE");
  try {
    const response = await env.INQUIRY.fetch(
      new Request(`https://internal/internal/projects/${INQUIRY_PROJECT_SLUG}/mail-receipts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transportId, messageId }),
      }),
    );
    // It may arrive before Core finishes recording the send. Resend will retry.
    if (response.status === 404) return json(503, "SEND_NOT_RECORDED_YET");
    if (response.status === 409) return json(409, "CONFLICT");
    return response.ok ? new Response(null, { status: 204 }) : json(503, "UNAVAILABLE");
  } catch {
    return json(503, "UNAVAILABLE");
  }
}
