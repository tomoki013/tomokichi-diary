import type { ErrorCode } from "./error-codes.js";

/**
 * A minimal validator for untrusted input.
 *
 * TypeScript types are erased at runtime, so every request body passes through
 * one of these (instruction §11). It is deliberately tiny rather than a schema
 * library: the shapes are small, and the Core stays dependency-free.
 */
export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export type Validated<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: ErrorCode; readonly issues: readonly ValidationIssue[] };

export type Validator<T> = (
  value: unknown,
  path: string,
) => { value?: T; issues: ValidationIssue[] };

const issue = (path: string, message: string): ValidationIssue => ({ path, message });

export const v = {
  string(options: { min?: number; max?: number; pattern?: RegExp } = {}): Validator<string> {
    return (value, path) => {
      if (typeof value !== "string") return { issues: [issue(path, "expected a string")] };
      if (options.min !== undefined && value.length < options.min) {
        return { issues: [issue(path, `must be at least ${options.min} characters`)] };
      }
      if (options.max !== undefined && value.length > options.max) {
        return { issues: [issue(path, `must be at most ${options.max} characters`)] };
      }
      if (options.pattern && !options.pattern.test(value)) {
        return { issues: [issue(path, "has an unexpected format")] };
      }
      return { value, issues: [] };
    };
  },

  number(options: { min?: number; max?: number; integer?: boolean } = {}): Validator<number> {
    return (value, path) => {
      if (typeof value !== "number" || Number.isNaN(value)) {
        return { issues: [issue(path, "expected a number")] };
      }
      if (options.integer && !Number.isInteger(value))
        return { issues: [issue(path, "expected an integer")] };
      if (options.min !== undefined && value < options.min) {
        return { issues: [issue(path, `must be at least ${options.min}`)] };
      }
      if (options.max !== undefined && value > options.max) {
        return { issues: [issue(path, `must be at most ${options.max}`)] };
      }
      return { value, issues: [] };
    };
  },

  boolean(): Validator<boolean> {
    return (value, path) =>
      typeof value === "boolean"
        ? { value, issues: [] }
        : { issues: [issue(path, "expected a boolean")] };
  },

  literalUnion<const T extends readonly string[]>(values: T): Validator<T[number]> {
    return (value, path) =>
      typeof value === "string" && values.includes(value)
        ? { value: value as T[number], issues: [] }
        : { issues: [issue(path, `expected one of: ${values.join(", ")}`)] };
  },

  array<T>(item: Validator<T>, options: { max?: number } = {}): Validator<T[]> {
    return (value, path) => {
      if (!Array.isArray(value)) return { issues: [issue(path, "expected an array")] };
      if (options.max !== undefined && value.length > options.max) {
        return { issues: [issue(path, `must have at most ${options.max} items`)] };
      }
      const out: T[] = [];
      const issues: ValidationIssue[] = [];
      for (const [index, element] of value.entries()) {
        const result = item(element, `${path}[${index}]`);
        issues.push(...result.issues);
        if (result.value !== undefined) out.push(result.value);
      }
      return issues.length > 0 ? { issues } : { value: out, issues: [] };
    };
  },

  object<S extends Record<string, Validator<unknown>>>(
    shape: S,
  ): Validator<{ [K in keyof S]: S[K] extends Validator<infer T> ? T : never }> {
    return (value, path) => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return { issues: [issue(path, "expected an object")] };
      }
      const source = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      const issues: ValidationIssue[] = [];
      for (const [key, validator] of Object.entries(shape)) {
        const result = validator(source[key], path === "" ? key : `${path}.${key}`);
        issues.push(...result.issues);
        if (result.value !== undefined) out[key] = result.value;
      }
      return issues.length > 0
        ? { issues }
        : {
            value: out as { [K in keyof S]: S[K] extends Validator<infer T> ? T : never },
            issues: [],
          };
    };
  },

  /** Absent and `null` both mean "not provided"; the default fills in. */
  optional<T>(inner: Validator<T>, fallback: T): Validator<T> {
    return (value, path) =>
      value === undefined || value === null ? { value: fallback, issues: [] } : inner(value, path);
  },

  nullable<T>(inner: Validator<T>): Validator<T | null> {
    return (value, path) =>
      value === undefined || value === null ? { value: null, issues: [] } : inner(value, path);
  },
};

export function validate<T>(validator: Validator<T>, input: unknown): Validated<T> {
  const result = validator(input, "");
  if (result.issues.length > 0 || result.value === undefined) {
    return { ok: false, code: "API_VALIDATION_FAILED", issues: result.issues };
  }
  return { ok: true, value: result.value };
}
