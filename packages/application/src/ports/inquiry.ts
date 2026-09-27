import type { ContactSubmission } from "@tomokichi/domain";

export interface ContactFiling extends ContactSubmission {
  /** Unique per submission, so a retried hand-off cannot open a second ticket. */
  readonly idempotencyKey: string;
}

/**
 * Where a reader's message is kept: the shared inquiry platform. The blog no
 * longer stores messages itself; it validates them and hands them over.
 */
export interface ContactInbox {
  /** Resolves to false when the platform refused or could not be reached. */
  file(filing: ContactFiling): Promise<boolean>;
}
