import type { ContactMailer } from "@tomokichi/application";
import { CONTACT_LANE_LABELS } from "@tomokichi/domain";

/** The email delivery port used by the contact notice. */
export interface ContactMailBinding {
  send(message: {
    from: { name: string; email: string };
    to: string;
    replyTo?: { name: string; email: string };
    subject: string;
    text: string;
  }): Promise<unknown>;
}

/** Sends through the domain-scoped Resend key configured on the API Worker. */
export function createResendContactMailBinding(
  apiKey: string,
  fetcher: typeof fetch = fetch,
): ContactMailBinding {
  return {
    send: async (message) => {
      const response = await fetcher("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: `${message.from.name} <${message.from.email}>`,
          to: [message.to],
          ...(message.replyTo
            ? { reply_to: `${message.replyTo.name} <${message.replyTo.email}>` }
            : {}),
          subject: message.subject,
          text: message.text,
        }),
      });
      if (!response.ok) throw new Error(`Resend email request failed (${response.status})`);
      return response.json();
    },
  };
}

/**
 * Where the admin opens a ticket by number. The same address the platform's
 * own notification links use (the studio seed's `ticketUrlTemplate`).
 */
export const ADMIN_TICKET_URL = "https://admin.tomokichidiary.com/#/inquiries/";

/**
 * Tells the blog's own inbox that a contact arrived. The recipient is fixed in
 * `cloudflare.config.ts`; the request cannot choose where a message is sent.
 *
 * Filed on the platform, the mail is only a notice: no name, address or
 * message, just a link to the ticket, where it is read and answered. If filing
 * fails, the mail carries the whole message and the reader becomes the Reply-To.
 */
export function createContactMailer(
  binding: ContactMailBinding,
  addresses: { from: string; to: string },
): ContactMailer {
  return {
    send: async (filing, filed) => {
      const lane = CONTACT_LANE_LABELS[filing.lane];
      const ticket = filed?.ticketNumber ?? null;
      const message = filed
        ? {
            subject: `[ともきちの旅行日記] 新しいお問い合わせ（${lane}）${ticket ? ` ${ticket}` : ""}`,
            text: [
              `${lane}のお問い合わせが届きました。内容は管理画面で確認してください。`,
              "",
              ticket ? `${ADMIN_TICKET_URL}${encodeURIComponent(ticket)}` : ADMIN_TICKET_URL,
            ].join("\n"),
          }
        : {
            subject: `[ともきちの旅行日記/${lane}] ${filing.subject}`,
            text: [
              `お名前: ${filing.name}`,
              `メール: ${filing.email}`,
              `種類: ${filing.subject}（${lane}）`,
              "",
              filing.body,
              "",
              "―",
              "共通お問い合わせ基盤に登録できなかったため、管理画面には出ていません。",
              "このメールに返信すると、送信者に届きます。",
            ].join("\n"),
          };
      try {
        await binding.send({
          from: { name: "ともきちの旅行日記 お問い合わせフォーム", email: addresses.from },
          to: addresses.to,
          ...(filed ? {} : { replyTo: { name: filing.name, email: filing.email } }),
          ...message,
        });
        return true;
      } catch {
        // A refused or unreachable send is reported as false, never thrown.
        return false;
      }
    },
  };
}
