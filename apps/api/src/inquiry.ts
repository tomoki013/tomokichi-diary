import { createInquiryClient, type IntakeBinding } from "@inquiry-platform/sdk";
import type { ContactInbox } from "@tomokichi/application";

/**
 * The slug this site is registered under on the inquiry platform. It must also
 * appear in the `INQUIRY` binding's `props.projects` in `cloudflare.config.ts`, or the
 * platform refuses every submission.
 */
export const INQUIRY_PROJECT_SLUG = "tomokichi-diary";

/** Adapts the platform SDK to the application's `ContactInbox` port. */
export function createInquiryInbox(binding: IntakeBinding): ContactInbox {
  const client = createInquiryClient(binding);
  return {
    file: async (filing) => {
      const result = await client
        .createContact({
          projectSlug: INQUIRY_PROJECT_SLUG,
          idempotencyKey: filing.idempotencyKey,
          name: filing.name,
          email: filing.email,
          subject: filing.subject,
          message: filing.body,
          channel: "web_form",
        })
        // A binding that throws is as unreachable as one that refuses.
        .catch(() => null);
      return result?.ok === true;
    },
  };
}
