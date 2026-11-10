import type { ErrorCode } from "./error-codes.js";

/**
 * A minimal validator for untrusted input.
 *
 * TypeScript types are erased at runtime, so every request body passes through
 * one of these (instruction §11). It is deliberately tiny rather than a schema
 * library: the shapes are small, and the Core stays dependency-free.
 *
 * Each validator also describes itself (`schema`), so one definition gives the
 * API its check, the admin its types and the MCP tools their input schema.
 */
export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export type Validated<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: ErrorCode; readonly issues: readonly ValidationIssue[] };

/** The subset of JSON Schema these validators can express. */
export interface InputSchema {
  readonly type?: "string" | "number" | "integer" | "boolean" | "array" | "object";
  readonly description?: string;
  readonly enum?: readonly string[];
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly maxItems?: number;
  readonly items?: InputSchema;
  readonly properties?: Readonly<Record<string, InputSchema>>;
  /** Keys a caller must send. */
  readonly required?: readonly string[];
  /** `null` is accepted as well. */
  readonly nullable?: boolean;
  /** Anything is accepted; the use case checks it. */
  readonly any?: boolean;
}

/**
 * `T` is what the handler receives; `In` is what a caller may send (a key
 * with a default or a `maybe` can be left out).
 */
export interface Validator<T, In = T> {
  (value: unknown, path: string): { value?: T; issues: ValidationIssue[] };
  readonly schema?: InputSchema;
  /** The key may be absent from its object. */
  readonly optionalKey?: boolean;
  /** Type-level only. */
  readonly __in?: In;
}

type AnyValidator = Validator<unknown, unknown>;
type OutOf<V> = V extends Validator<infer T, unknown> ? T : never;
type InOf<V> = V extends Validator<unknown, infer In> ? In : never;
type OptionalKeys<S> = { [K in keyof S]: undefined extends InOf<S[K]> ? K : never }[keyof S];
type Simplify<T> = { [K in keyof T]: T[K] } & {};
type ObjectOut<S> = { [K in keyof S]: OutOf<S[K]> };
type ObjectIn<S> = Simplify<
  { [K in Exclude<keyof S, OptionalKeys<S>>]: InOf<S[K]> } & {
    [K in OptionalKeys<S>]?: InOf<S[K]>;
  }
>;

const issue = (path: string, message: string): ValidationIssue => ({ path, message });

function make<T, In = T>(
  check: (value: unknown, path: string) => { value?: T; issues: ValidationIssue[] },
  schema: InputSchema,
  optionalKey = false,
): Validator<T, In> {
  return Object.assign(check, { schema, optionalKey });
}

export const v = {
  string(options: { min?: number; max?: number; pattern?: RegExp } = {}): Validator<string> {
    return make(
      (value, path) => {
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
      },
      {
        type: "string",
        ...(options.min !== undefined ? { minLength: options.min } : {}),
        ...(options.max !== undefined ? { maxLength: options.max } : {}),
        ...(options.pattern ? { pattern: options.pattern.source } : {}),
      },
    );
  },

  number(options: { min?: number; max?: number; integer?: boolean } = {}): Validator<number> {
    return make(
      (value, path) => {
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
      },
      {
        type: options.integer ? "integer" : "number",
        ...(options.min !== undefined ? { minimum: options.min } : {}),
        ...(options.max !== undefined ? { maximum: options.max } : {}),
      },
    );
  },

  boolean(): Validator<boolean> {
    return make(
      (value, path) =>
        typeof value === "boolean"
          ? { value, issues: [] }
          : { issues: [issue(path, "expected a boolean")] },
      { type: "boolean" },
    );
  },

  literalUnion<const T extends readonly string[]>(values: T): Validator<T[number]> {
    return make(
      (value, path) =>
        typeof value === "string" && values.includes(value)
          ? { value: value as T[number], issues: [] }
          : { issues: [issue(path, `expected one of: ${values.join(", ")}`)] },
      { type: "string", enum: values },
    );
  },

  array<T, In = T>(item: Validator<T, In>, options: { max?: number } = {}): Validator<T[], In[]> {
    return make(
      (value, path) => {
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
      },
      {
        type: "array",
        ...(item.schema ? { items: item.schema } : {}),
        ...(options.max !== undefined ? { maxItems: options.max } : {}),
      },
    );
  },

  object<S extends Record<string, AnyValidator>>(shape: S): Validator<ObjectOut<S>, ObjectIn<S>> {
    const entries = Object.entries(shape);
    return make(
      (value, path) => {
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
          return { issues: [issue(path, "expected an object")] };
        }
        const source = value as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        const issues: ValidationIssue[] = [];
        for (const [key, validator] of entries) {
          const result = validator(source[key], path === "" ? key : `${path}.${key}`);
          issues.push(...result.issues);
          if (result.value !== undefined) out[key] = result.value;
        }
        return issues.length > 0 ? { issues } : { value: out as ObjectOut<S>, issues: [] };
      },
      {
        type: "object",
        properties: Object.fromEntries(
          entries.map(([key, validator]) => [key, validator.schema ?? { any: true }]),
        ),
        required: entries.filter(([, validator]) => !validator.optionalKey).map(([key]) => key),
      },
    );
  },

  /** Absent and `null` both mean "not provided"; the default fills in. */
  optional<T, In = T>(inner: Validator<T, In>, fallback: T): Validator<T, In | null | undefined> {
    return make(
      (value, path) =>
        value === undefined || value === null
          ? { value: fallback, issues: [] }
          : inner(value, path),
      inner.schema ?? { any: true },
      true,
    );
  },

  nullable<T, In = T>(inner: Validator<T, In>): Validator<T | null, In | null | undefined> {
    return make(
      (value, path) =>
        value === undefined || value === null ? { value: null, issues: [] } : inner(value, path),
      { ...(inner.schema ?? { any: true }), nullable: true },
      true,
    );
  },

  /**
   * A field of a partial update: absent means "leave it as it is" and reaches
   * the handler as a missing key. Wrap a `nullable` to let `null` clear it.
   */
  maybe<T, In = T>(inner: Validator<T, In>): Validator<T | undefined, In | undefined> {
    return make(
      (value, path) => (value === undefined ? { issues: [] } : inner(value, path)),
      inner.schema ?? { any: true },
      true,
    );
  },

  /** Passed through unchecked: the use case validates it field by field. */
  unknown(): Validator<unknown> {
    return make((value) => ({ value: value ?? null, issues: [] }), { any: true }, true);
  },

  /** Says what a field is for; shown to MCP clients beside the field. */
  describe<T, In>(inner: Validator<T, In>, description: string): Validator<T, In> {
    return make<T, In>(
      (value, path) => inner(value, path),
      { ...(inner.schema ?? { any: true }), description },
      inner.optionalKey,
    );
  },
};

export function validate<T, In = T>(validator: Validator<T, In>, input: unknown): Validated<T> {
  const result = validator(input, "");
  if (result.issues.length > 0 || result.value === undefined) {
    return { ok: false, code: "API_VALIDATION_FAILED", issues: result.issues };
  }
  return { ok: true, value: result.value };
}
