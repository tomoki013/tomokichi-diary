import type { ErrorCode } from "@tomokichi/contracts";

export interface DomainError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly field?: string;
}

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly DomainError[] };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T>(...errors: readonly DomainError[]): Result<T> {
  return { ok: false, errors };
}

export function unwrap<T>(result: Result<T>): T {
  if (result.ok) return result.value;
  throw new Error(result.errors.map((e) => `${e.code}: ${e.message}`).join("; "));
}
