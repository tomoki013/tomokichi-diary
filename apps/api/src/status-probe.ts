import type { ProjectOperatorClient } from "@inquiry-platform/sdk";

/**
 * What the status platform (tomokichi-status) may learn about the contact
 * pipeline, read-only. Contract: tomokichi-status `docs/adr/0001-product-status-probe.md`.
 *
 * Nothing here creates a ticket, sends mail or writes to the database. The
 * answer carries states and two numbers — never ticket contents, addresses,
 * error text or which hosts are involved.
 */

export type ProbeState = "UP" | "DOWN" | "DEGRADED" | "UNKNOWN";

export interface StatusProbeResult {
  schema_version: 1;
  checked_at: string;
  checks: {
    inquiry_core: { state: ProbeState };
    mail_delivery: {
      state: ProbeState;
      failed: number | null;
      oldest_queued_seconds: number | null;
    };
    turnstile: { state: ProbeState; configured: boolean };
  };
}

/** Each platform call gets this long; the whole probe stays well under 5 s. */
export const CALL_TIMEOUT_MS = 2_000;

const TIMEOUT = Symbol("timeout");

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<typeof TIMEOUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMEOUT), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function inquiryCore(operator: ProjectOperatorClient | null): Promise<ProbeState> {
  if (!operator) return "UNKNOWN";
  try {
    const result = await withTimeout(operator.project(), CALL_TIMEOUT_MS);
    if (result === TIMEOUT) return "DOWN";
    return result.ok ? "UP" : "DOWN";
  } catch {
    return "DOWN";
  }
}

/**
 * Delivery state needs `listDeliveryJobs()`, which the pinned SDK (v0.3.1)
 * does not have; it arrived in v0.8.0. Until this site moves to that SDK the
 * honest answer is "unknown" — not "fine".
 */
function mailDelivery(): StatusProbeResult["checks"]["mail_delivery"] {
  return { state: "UNKNOWN", failed: null, oldest_queued_seconds: null };
}

export async function runStatusProbe(input: {
  operator: ProjectOperatorClient | null;
  turnstileSecret: string | undefined;
  now: number;
}): Promise<StatusProbeResult> {
  const core = await inquiryCore(input.operator);
  const mail = mailDelivery();
  // Without its secret the contact form refuses every submission
  // (`routes/contact.ts`), so an unset secret is an outage, not "off".
  const configured = Boolean(input.turnstileSecret?.trim());
  return {
    schema_version: 1,
    checked_at: new Date(input.now).toISOString(),
    checks: {
      inquiry_core: { state: core },
      mail_delivery: mail,
      turnstile: { state: configured ? "UP" : "DOWN", configured },
    },
  };
}
