import {
  err,
  ok,
  validateContactSubmission,
  type ContactMessage,
  type ContactMessageId,
  type ContactMessageStatus,
  type Result,
} from "@tomokichi/domain";
import type { AppContext } from "../../context.js";
import type { ContactFiling } from "../../ports/inquiry.js";

/**
 * A new message is mailed to the blog's inbox, where it is read and answered,
 * and a copy is filed on the shared inquiry platform. Nothing is written to D1:
 * the `contact_messages` table only holds what arrived before the switch.
 *
 * Accepted when either arrived, so the message always exists somewhere the
 * owner looks; whichever failed is logged. Refused only when neither did.
 */
export async function submitContactMessage(
  ctx: AppContext,
  input: ContactFiling,
): Promise<Result<null>> {
  const errors = validateContactSubmission(input);
  if (errors.length > 0) return err<null>(...errors);

  const filing: ContactFiling = {
    idempotencyKey: input.idempotencyKey,
    name: input.name.trim(),
    email: input.email.trim(),
    subject: input.subject.trim(),
    body: input.body.trim(),
  };
  // Neither may throw; an unbound one counts as failed.
  const [mailed, filed] = await Promise.all([
    ctx.contactMail ? ctx.contactMail.send(filing) : Promise.resolve(false),
    ctx.inquiry ? ctx.inquiry.file(filing) : Promise.resolve(false),
  ]);
  if (!mailed) ctx.logger.error("contact.not_mailed", { code: "API_INTERNAL" });
  if (!filed) ctx.logger.error("contact.not_filed", { code: "API_INTERNAL" });
  // A success with neither would mean a message that exists nowhere.
  if (!mailed && !filed) {
    return err<null>({ code: "API_INTERNAL", message: "お問い合わせを受け付けられませんでした" });
  }

  ctx.logger.info("contact.accepted", { mailed, filed });
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
