import { createInquiryClient, type IntakeBinding } from "@inquiry-platform/sdk";
import type { ContactInbox } from "@tomokichi/application";
import type { ContactLane } from "@tomokichi/domain";

/**
 * The slug this site is registered under on the inquiry platform. It must also
 * appear in the `INQUIRY` and `INQUIRY_OPERATOR` bindings' `props.projects` in
 * `cloudflare.config.ts`, or the platform refuses every call.
 */
export const INQUIRY_PROJECT_SLUG = "tomokichi-diary";

/**
 * Which platform project each lane files to. Every lane shares this site's
 * project today, so one admin screen, one set of reply templates and one
 * signature serve them all. Giving media enquiries their own project (their
 * own templates, signature and sending address) is a change here, a second
 * slug in both bindings' `props.projects`, and the admin choosing the project
 * by lane — see docs/OPERATIONS.md, "Contact lanes".
 */
export const INQUIRY_PROJECT_BY_LANE: Readonly<Record<ContactLane, string>> = {
  general: INQUIRY_PROJECT_SLUG,
  media: INQUIRY_PROJECT_SLUG,
};

/** Adapts the platform SDK to the application's `ContactInbox` port. */
export function createInquiryInbox(binding: IntakeBinding): ContactInbox {
  const client = createInquiryClient(binding);
  return {
    file: async (filing) => {
      const result = await client
        .createContact({
          projectSlug: INQUIRY_PROJECT_BY_LANE[filing.lane],
          idempotencyKey: filing.idempotencyKey,
          name: filing.name,
          email: filing.email,
          subject: filing.subject,
          message: filing.body,
          channel: "web_form",
        })
        // A binding that throws is as unreachable as one that refuses.
        .catch(() => null);
      return result?.ok === true ? { ticketNumber: result.value.ticketNumber } : null;
    },
  };
}
