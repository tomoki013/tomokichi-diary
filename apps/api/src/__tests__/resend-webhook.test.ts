import { describe, expect, it, vi } from "vitest";
import { resendWebhook } from "../resend-webhook.js";
import type { Env } from "../env.js";

const secret = `whsec_${btoa("test-only-signing-key-for-webhook")}`;
const transportId = "d56f4e72-18ce-4c0f-8e24-0b1a9a7dd234";
const messageId = "<actual@provider.example>";
const event = {
  type: "email.sent",
  data: {
    email_id: transportId,
    message_id: messageId,
    from: "ともきちの旅行日記 <contact@tomokichidiary.com>",
    to: ["private@example.com"],
    subject: "Private subject",
  },
};
async function signed(
  body = JSON.stringify(event),
  timestamp = String(Math.floor(Date.now() / 1000)),
) {
  const id = "msg_test_event";
  const bytes = Uint8Array.from(atob(secret.slice(6)), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "raw",
    bytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`)),
  );
  const encoded = btoa(String.fromCharCode(...signature));
  return new Request("https://api.example.com/webhooks/resend", {
    method: "POST",
    body,
    headers: { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": `v1,${encoded}` },
  });
}
function setup(status = 200) {
  const fetch = vi.fn(async () => new Response(null, { status }));
  const env = { RESEND_WEBHOOK_SECRET: secret, INQUIRY: { fetch } } as unknown as Env;
  return { fetch, env };
}

describe("signed Resend delivery IDs", () => {
  it("passes only IDs through the project-scoped Intake", async () => {
    const { fetch, env } = setup();
    expect((await resendWebhook(await signed(), env)).status).toBe(204);
    const request = fetch.mock.calls[0]?.[0] as unknown as Request;
    expect(request.url).toBe("https://internal/internal/projects/tomokichi-diary/mail-receipts");
    expect(await request.json()).toEqual({ transportId, messageId });
  });
  it("rejects unsigned, changed and stale payloads before calling Core", async () => {
    const { fetch, env } = setup();
    expect(
      (
        await resendWebhook(
          new Request("https://api.example.com", { method: "POST", body: JSON.stringify(event) }),
          env,
        )
      ).status,
    ).toBe(401);
    const original = await signed();
    expect(
      (
        await resendWebhook(
          new Request(original.url, {
            method: "POST",
            headers: original.headers,
            body: JSON.stringify({ ...event, type: "changed" }),
          }),
          env,
        )
      ).status,
    ).toBe(401);
    expect((await resendWebhook(await signed(JSON.stringify(event), "100"), env)).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("is unavailable without the signing secret and bounds input size", async () => {
    const { fetch, env } = setup();
    expect(
      (await resendWebhook(await signed(), { ...env, RESEND_WEBHOOK_SECRET: undefined })).status,
    ).toBe(404);
    expect((await resendWebhook(await signed("x".repeat(65537)), env)).status).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("ignores notification senders and other projects", async () => {
    const { fetch, env } = setup();
    for (const from of ["noreply@tomokichidiary.com", "support@other.example"]) {
      expect(
        (
          await resendWebhook(
            await signed(JSON.stringify({ ...event, data: { ...event.data, from } })),
            env,
          )
        ).status,
      ).toBe(204);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it("asks the provider to retry when the send is not committed yet", async () => {
    const { env } = setup(404);
    expect((await resendWebhook(await signed(), env)).status).toBe(503);
  });
  it("rejects malformed IDs after verifying the signature", async () => {
    const { fetch, env } = setup();
    const bad = { ...event, data: { ...event.data, message_id: "header\r\ninjection" } };
    expect((await resendWebhook(await signed(JSON.stringify(bad)), env)).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
});
