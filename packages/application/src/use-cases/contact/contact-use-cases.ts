import {
  acceptContactSubmission,
  err,
  looksLikeSpam,
  ok,
  type ContactMessage,
  type ContactMessageId,
  type ContactMessageStatus,
  type ContactSubmission,
  type Result,
} from "@tomokichi/domain";
import type { AppContext } from "../../context.js";

/**
 * Submissions are stored and read in the admin rather than emailed, so the
 * form needs no third-party provider and no sending domain to work.
 */
export interface SubmitContactInput extends ContactSubmission {
  /** Salted hash of the sender's address; the address itself is never stored. */
  readonly ipHash: string;
}

export async function submitContactMessage(
  ctx: AppContext,
  input: SubmitContactInput,
): Promise<Result<ContactMessage>> {
  const previous = await ctx.repos.contactMessages.findLatestByIpHash(input.ipHash);
  const now = ctx.clock.now();

  const accepted = acceptContactSubmission({ input, previous, now });
  if (!accepted.ok) return err<ContactMessage>(...accepted.errors);

  const message: ContactMessage = {
    id: ctx.ids.next<ContactMessageId>(),
    name: input.name.trim(),
    email: input.email.trim(),
    subject: input.subject.trim(),
    body: input.body.trim(),
    ipHash: input.ipHash,
    // Flagged, not dropped: a false positive stays readable in the admin.
    status: looksLikeSpam(input) ? "spam" : "unread",
    createdAt: now,
  };

  await ctx.repos.contactMessages.save(message);
  ctx.logger.info("contact.received", { messageId: message.id, status: message.status });
  return ok(message);
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
