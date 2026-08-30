import type { Brand } from "../primitives/brand.js";
import type { Instant } from "../primitives/datetime.js";

export type ContactMessageId = Brand<string, "ContactMessageId">;

export const CONTACT_MESSAGE_STATUSES = ["unread", "read", "spam"] as const;
export type ContactMessageStatus = (typeof CONTACT_MESSAGE_STATUSES)[number];

export interface ContactMessage {
  readonly id: ContactMessageId;
  readonly name: string;
  readonly email: string;
  readonly subject: string;
  readonly body: string;
  /** Salted hash of the sender's address, used only to rate-limit submissions. */
  readonly ipHash: string;
  readonly status: ContactMessageStatus;
  readonly createdAt: Instant;
}
