import type { ContactMailer } from "@tomokichi/application";
import { CONTACT_LANE_LABELS } from "@tomokichi/domain";

/** The part of Cloudflare's `send_email` binding this file uses. */
export interface ContactMailBinding {
  send(message: {
    from: { name: string; email: string };
    to: string;
    replyTo?: { name: string; email: string };
    subject: string;
    text: string;
  }): Promise<unknown>;
}

/**
 * Where the admin opens a ticket by number. The same address the platform's
 * own notification links use (the studio seed's `ticketUrlTemplate`).
 */
export const ADMIN_TICKET_URL = "https://admin.tomokichidiary.com/#/inquiries/";

/**
 * Tells the blog's own inbox that a contact arrived. The binding is pinned to
 * that one verified address in `cloudflare.config.ts`, so this can mail nobody
 * else.
 *
 * Filed on the platform, the mail links to the ticket and has no Reply-To: the
 * reply is written in the admin, so the ticket keeps the whole conversation and
 * the reader hears from one address. Not filed, the mail is the only copy, so
 * the reader becomes the Reply-To and it is answered from the inbox.
 */
export function createContactMailer(
  binding: ContactMailBinding,
  addresses: { from: string; to: string },
): ContactMailer {
  return {
    send: async (filing, filed) => {
      const lane = CONTACT_LANE_LABELS[filing.lane];
      const ticket = filed?.ticketNumber ?? null;
      const footer = filed
        ? [
            ticket
              ? `返信は管理画面から: ${ADMIN_TICKET_URL}${encodeURIComponent(ticket)}`
              : `返信は管理画面から: ${ADMIN_TICKET_URL}`,
            "このメールに返信しても送信者には届きません。",
          ]
        : [
            "共通お問い合わせ基盤に登録できなかったため、管理画面には出ていません。",
            "このメールに返信すると、送信者に届きます。",
          ];
      try {
        await binding.send({
          from: { name: "ともきちの旅行日記 お問い合わせフォーム", email: addresses.from },
          to: addresses.to,
          ...(filed ? {} : { replyTo: { name: filing.name, email: filing.email } }),
          subject: `[ともきちの旅行日記/${lane}]${ticket ? ` ${ticket}` : ""} ${filing.subject}`,
          text: [
            `お名前: ${filing.name}`,
            `メール: ${filing.email}`,
            `種類: ${filing.subject}（${lane}）`,
            "",
            filing.body,
            "",
            "―",
            "tomokichidiary.com のお問い合わせフォームから送信されました。",
            ...footer,
          ].join("\n"),
        });
        return true;
      } catch {
        // A refused or unreachable send is reported as false, never thrown.
        return false;
      }
    },
  };
}
