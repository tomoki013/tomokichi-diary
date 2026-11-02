import {
  err,
  findContactTopic,
  ok,
  validateContactSubmission,
  type ContactMessage,
  type ContactMessageId,
  type ContactMessageStatus,
  type ContactSubmission,
  type Result,
} from "@tomokichi/domain";
import type { AppContext } from "../../context.js";
import type { ContactFiling } from "../../ports/inquiry.js";

export interface ContactInput extends ContactSubmission {
  readonly idempotencyKey: string;
}

/**
 * A new message is filed on the shared inquiry platform, where it is worked and
 * answered from this site's admin, and the blog's inbox is told it arrived.
 * Nothing is written to D1: the `contact_messages` table only holds what
 * arrived before the switch.
 *
 * `subject` is the topic the reader picked (its key, or its label from an
 * older page); it is filed under the topic's label and lane. Filing goes first
 * so the mail can point at the ticket. Accepted when either arrived, so the
 * message always exists somewhere the owner looks; whichever failed is logged.
 * Refused only when neither did.
 *
 * Once the filing is in, the sender has nothing left to wait for: where the
 * runtime can finish work after responding, the mail goes out then. Only when
 * filing failed is the mail awaited, because it is then the one place the
 * message exists.
 */
export async function submitContactMessage(
  ctx: AppContext,
  input: ContactInput,
): Promise<Result<null>> {
  const errors = validateContactSubmission(input);
  if (errors.length > 0) return err<null>(...errors);
  const topic = findContactTopic(input.subject);
  if (!topic) {
    return err<null>({
      code: "API_VALIDATION_FAILED",
      message: "お問い合わせの種類を選んでください",
      field: "subject",
    });
  }

  const filing: ContactFiling = {
    idempotencyKey: input.idempotencyKey,
    lane: topic.lane,
    name: input.name.trim(),
    email: input.email.trim(),
    subject: topic.label,
    body: input.body.trim(),
  };
  // Neither may throw; an unbound one counts as failed.
  const filed = ctx.inquiry ? await ctx.inquiry.file(filing) : null;
  if (filed && ctx.contactMail && ctx.defer) {
    const mail = ctx.contactMail;
    ctx.defer(
      mail.send(filing, filed).then((sent) => {
        if (!sent) ctx.logger.error("contact.not_mailed", { code: "API_INTERNAL" });
      }),
    );
    ctx.logger.info("contact.accepted", { mailed: "deferred", filed: true, lane: topic.lane });
    return ok(null);
  }
  const mailed = ctx.contactMail ? await ctx.contactMail.send(filing, filed) : false;
  if (!mailed) ctx.logger.error("contact.not_mailed", { code: "API_INTERNAL" });
  if (!filed) ctx.logger.error("contact.not_filed", { code: "API_INTERNAL" });
  // A success with neither would mean a message that exists nowhere.
  if (!mailed && !filed) {
    return err<null>({ code: "API_INTERNAL", message: "お問い合わせを受け付けられませんでした" });
  }

  ctx.logger.info("contact.accepted", { mailed, filed: filed !== null, lane: topic.lane });
  return ok(null);
}

export function listContactMessages(
  ctx: AppContext,
  limit = 100,
): Promise<readonly ContactMessage[]> {
  return ctx.repos.contactMessages.list(limit);
}

export async function setContactMessageStatus(
  ctx: AppContext,
  id: ContactMessageId,
  status: ContactMessageStatus,
): Promise<Result<null>> {
  await ctx.repos.contactMessages.setStatus(id, status);
  return ok(null);
}

export function countUnreadContactMessages(ctx: AppContext): Promise<number> {
  return ctx.repos.contactMessages.countUnread();
}
