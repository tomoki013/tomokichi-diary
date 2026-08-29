import type { Brand } from "./brand.js";
import { err, ok, type Result } from "./result.js";

/** ISO-8601 UTC instant, e.g. `2026-08-24T00:00:00.000Z`. Stored as text everywhere. */
export type Instant = Brand<string, "Instant">;

/** Calendar date without a time, e.g. `2026-08-24`. Used for travel dates. */
export type PlainDate = Brand<string, "PlainDate">;

const PLAIN_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function instantFrom(value: Date | number | string): Instant {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString() as Instant;
}

export function parseInstant(value: string): Result<Instant> {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return err({ code: "API_VALIDATION_FAILED", message: `invalid instant: ${value}` });
  }
  return ok(date.toISOString() as Instant);
}

export function parsePlainDate(value: string): Result<PlainDate> {
  if (!PLAIN_DATE_RE.test(value) || Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())) {
    return err({ code: "API_VALIDATION_FAILED", message: `invalid date: ${value}` });
  }
  return ok(value as PlainDate);
}

export function toPlainDate(instant: Instant): PlainDate {
  return instant.slice(0, 10) as PlainDate;
}

export function compareInstants(a: Instant, b: Instant): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isBefore(a: Instant, b: Instant): boolean {
  return Date.parse(a) < Date.parse(b);
}

export function isAfterOrEqual(a: Instant, b: Instant): boolean {
  return Date.parse(a) >= Date.parse(b);
}
