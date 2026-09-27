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
 * New messages go to the shared inquiry platform, where replies, status and
 * history live alongside every other project's. Nothing is written to D1: the
 * `contact_messages` table only holds what arrived before the switch.
 */
export async function submitContactMessage(
  ctx: AppContext,
  input: ContactFiling,
): Promise<Result<null>> {
  const errors = validateContactSubmission(input);
  if (errors.length > 0) return err<null>(...errors);

  // An unbound platform refuses rather than pretending: a success here would
  // mean a message that exists nowhere.
  const filed =
    ctx.inquiry !== undefined &&
    (await ctx.inquiry.file({
      idempotencyKey: input.idempotencyKey,
      name: input.name.trim(),
      email: input.email.trim(),
      subject: input.subject.trim(),
      body: input.body.trim(),
    }));
  if (!filed) {
    ctx.logger.error("contact.not_filed", { code: "API_INTERNAL" });
    return err<null>({ code: "API_INTERNAL", message: "お問い合わせを受け付けられませんでした" });
  }

  ctx.logger.info("contact.filed", {});
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
