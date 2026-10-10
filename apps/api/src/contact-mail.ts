import type { ContactMailer } from "@tomokichi/application";

/** The part of Cloudflare's `send_email` binding this file uses. */
export interface ContactMailBinding {
  send(message: {
    from: { name: string; email: string };
    to: string;
    replyTo: { name: string; email: string };
    subject: string;
    text: string;
  }): Promise<unknown>;
}

/**
 * Mails a contact to the blog's own inbox. The binding is pinned to that one
 * verified address in `cloudflare.config.ts`, so this can mail nobody else;
 * the reader is the Reply-To, so answering is an ordinary reply.
 */
export function createContactMailer(
  binding: ContactMailBinding,
  addresses: { from: string; to: string },
): ContactMailer {
  return {
    send: async (filing) => {
      try {
        await binding.send({
          from: { name: "ともきちの旅行日記 お問い合わせフォーム", email: addresses.from },
          to: addresses.to,
          replyTo: { name: filing.name, email: filing.email },
          subject: `[ともきちの旅行日記] ${filing.subject}`,
          text: [
            `お名前: ${filing.name}`,
            `メール: ${filing.email}`,
            `件名: ${filing.subject}`,
            "",
            filing.body,
            "",
            "―",
            "tomokichidiary.com のお問い合わせフォームから送信されました。",
            "このメールに返信すると、送信者に届きます。",
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
