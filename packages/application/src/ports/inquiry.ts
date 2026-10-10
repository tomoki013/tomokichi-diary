import type { ContactSubmission } from "@tomokichi/domain";

export interface ContactFiling extends ContactSubmission {
  /** Unique per submission, so a retried hand-off cannot open a second ticket. */
  readonly idempotencyKey: string;
}

/**
 * Where a copy of a reader's message is kept: the shared inquiry platform. The
 * blog does not store messages itself; it validates them and hands them over.
 */
export interface ContactInbox {
  /** Resolves to false when the platform refused or could not be reached. */
  file(filing: ContactFiling): Promise<boolean>;
}

/**
 * Where a reader's message is read and answered: the blog's own inbox. The
 * mail carries the message itself, with the reader as Reply-To, so answering
 * is an ordinary reply from that inbox.
 */
export interface ContactMailer {
  /** Resolves to false when the mail could not be sent. Never throws. */
  send(filing: ContactFiling): Promise<boolean>;
}
