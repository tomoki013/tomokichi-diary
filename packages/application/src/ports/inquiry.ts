import type { ContactLane, ContactSubmission } from "@tomokichi/domain";

export interface ContactFiling extends ContactSubmission {
  /** Unique per submission, so a retried hand-off cannot open a second ticket. */
  readonly idempotencyKey: string;
  /** How the message is handled; decides where it is filed. */
  readonly lane: ContactLane;
}

/** What the platform gave the message: its ticket, as the admin finds it. */
export interface ContactFiled {
  /** e.g. `TK-000123`; null when the platform numbers it later. */
  readonly ticketNumber: string | null;
}

/**
 * Where a reader's message is kept, worked and answered: the shared inquiry
 * platform, through this site's admin. The blog does not store messages
 * itself; it validates them and hands them over.
 */
export interface ContactInbox {
  /** Resolves to null when the platform refused or could not be reached. Never throws. */
  file(filing: ContactFiling): Promise<ContactFiled | null>;
}

/**
 * Tells the blog's own inbox that a message arrived. With a ticket the mail
 * points at it in the admin, where the reply is written; without one (the
 * platform was unreachable) the mail is the only copy, so it carries the
 * reader as Reply-To and is answered from the inbox itself.
 */
export interface ContactMailer {
  /** Resolves to false when the mail could not be sent. Never throws. */
  send(filing: ContactFiling, filed: ContactFiled | null): Promise<boolean>;
}
