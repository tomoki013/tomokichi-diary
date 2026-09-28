import { createPlatformApiClient, type PlatformApiResult } from "@inquiry-platform/sdk";
import type { Env } from "./env.js";
import { INQUIRY_PROJECT_SLUG } from "./inquiry.js";

/**
 * The inquiry platform's operator API, as the diary admin reaches it.
 *
 * The platform ships no UI; each project builds its own on the gateway's API
 * (`admin.tmkch.io`). The browser cannot call it directly — no CORS, and a
 * different Cloudflare Access application — so the diary API calls it on the
 * operator's behalf, after its own admin gate has let them in, presenting a
 * Cloudflare Access service token that the gateway's Access application
 * accepts.
 *
 * Everything that crosses here is narrowed to this site's own project: the
 * platform also holds every other project's tickets, and the diary admin has
 * no business reading them.
 */

/** Only the fields the admin shows. The platform's rows carry more. */
export interface PlatformTicket {
  id: string;
  ticket_number: string;
  type: string;
  status: TicketStatus;
  resolution: string | null;
  priority: string;
  impact: string;
  urgency: string;
  service_id: string;
  subject: string;
  summary: string | null;
  requester_email: string | null;
  created_at: string;
  updated_at: string;
  acknowledged_at: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  next_action: string | null;
  next_action_at: string | null;
  revision: number;
  sla_state: "OK" | "AT_RISK" | "BREACHED";
  thread_id: string | null;
}

export type TicketStatus =
  | "NEW"
  | "TRIAGE"
  | "ACKNOWLEDGED"
  | "IN_PROGRESS"
  | "WAITING_CUSTOMER"
  | "WAITING_INTERNAL"
  | "RESOLVED"
  | "CLOSED";

export interface PlatformTicketDetail {
  ticket: PlatformTicket;
  timeline: (
    | {
        kind: "message";
        value: {
          id: string;
          direction: "INBOUND" | "OUTBOUND";
          visibility: "PUBLIC" | "INTERNAL";
          sender: string | null;
          body: string;
          created_at: string;
        };
      }
    | {
        kind: "event";
        value: { id: string; event_type: string; metadata: string; created_at: string };
      }
  )[];
  totalTimeline: number;
}

export type OperatorFailure = {
  ok: false;
  kind: "not_configured" | "not_registered" | "not_found" | "rejected" | "conflict" | "unavailable";
  message: string;
  fields?: Record<string, string>;
};
export type OperatorResult<T> = { ok: true; value: T } | OperatorFailure;

export interface InquiryOperator {
  /** The platform's id for this site's project, or a failure saying why there is none. */
  projectId(): Promise<OperatorResult<string>>;
  request<T>(path: string, init?: RequestInit): Promise<OperatorResult<T>>;
}

/** App ids never change once registered, so one lookup per isolate is enough. */
const projectIds = new Map<string, string>();

export function createInquiryOperator(env: Env, fetcher?: typeof fetch): InquiryOperator | null {
  const origin = env.INQUIRY_API_ORIGIN?.trim();
  const clientId = env.INQUIRY_ACCESS_CLIENT_ID?.trim();
  const clientSecret = env.INQUIRY_ACCESS_CLIENT_SECRET?.trim();
  if (!origin || !clientId || !clientSecret) return null;

  const base = fetcher ?? globalThis.fetch.bind(globalThis);
  const client = createPlatformApiClient({
    origin,
    // Service-token headers, not a bearer: Access exchanges them at the edge
    // for a token minted for the gateway's own application.
    fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("CF-Access-Client-Id", clientId);
      headers.set("CF-Access-Client-Secret", clientSecret);
      // An Access login redirect is a configuration problem, not a page to follow.
      return base(input, { ...init, headers, redirect: "manual" });
    },
  });

  const request = async <T>(path: string, init?: RequestInit): Promise<OperatorResult<T>> =>
    fromPlatform(await client.request<T>(path, init));

  return {
    request,
    projectId: async () => {
      const cached = projectIds.get(origin);
      if (cached) return { ok: true, value: cached };
      const apps = await request<{ id: string; slug: string }[]>("/api/apps");
      if (!apps.ok) return apps;
      const found = apps.value.find((app) => app.slug === INQUIRY_PROJECT_SLUG);
      if (!found) {
        return {
          ok: false,
          kind: "not_registered",
          message: `project ${INQUIRY_PROJECT_SLUG} is not registered on the inquiry platform`,
        };
      }
      projectIds.set(origin, found.id);
      return { ok: true, value: found.id };
    },
  };
}

function fromPlatform<T>(result: PlatformApiResult<T>): OperatorResult<T> {
  if (result.ok) return { ok: true, value: result.data };
  const { code, message, fields } = result.error;
  const kind: OperatorFailure["kind"] =
    code === "VALIDATION_ERROR"
      ? "rejected"
      : code === "NOT_FOUND"
        ? "not_found"
        : code === "CONFLICT" || code === "INVALID_STATUS_TRANSITION"
          ? "conflict"
          : // UNAUTHORIZED / FORBIDDEN mean the service token is wrong, which
            // is the deployment's problem rather than the operator's.
            "unavailable";
  return { ok: false, kind, message, ...(fields ? { fields } : {}) };
}

/** Test seam: the project-id cache outlives a single test otherwise. */
export function forgetInquiryProject(): void {
  projectIds.clear();
}
