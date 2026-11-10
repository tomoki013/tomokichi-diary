import type { Validator } from "../validation.js";

/**
 * One thing the owner can do to the site, defined once. The API validates and
 * runs it, the admin calls it with these types, and the internal MCP servers
 * list it as a tool — so a capability cannot exist in one and not the others.
 * See docs/design/admin-rebuild.md.
 */
export type OperationKind = "read" | "write" | "delete";

/**
 * Who may reach an operation besides the admin itself.
 * - `operator`: the Operator MCP (reads always, writes with `operator:write`).
 * - `analytics`: the Analytics MCP.
 * - `admin-only`: the admin, with the owner signed in. Reserved for the cases
 *   named in `ADMIN_ONLY_OPERATIONS`.
 */
export type OperationSurface = "operator" | "analytics" | "admin-only";

/** How an operation appears as an MCP tool. */
export interface OperationTool {
  /** The tool's name. Existing names are kept so connected clients keep working. */
  readonly name: string;
  readonly title: string;
  /**
   * An extra input the caller must restate before something hard to take back
   * happens: a fixed word, or the same value as another field.
   */
  readonly confirm?: {
    readonly field: string;
    readonly literal?: string;
    readonly sameAs?: string;
    readonly description: string;
  };
  /** Changes more than the caller named (e.g. ends a running test). */
  readonly destructive?: boolean;
}

/** What the audit log records as the thing an operation acted on. */
export interface OperationTarget {
  readonly type: string;
  /** The input field holding its id; absent for list-wide operations. */
  readonly idField?: string;
}

export interface OperationSpec<Parsed = unknown, Output = unknown, Input = Parsed> {
  readonly kind: OperationKind;
  readonly surface: OperationSurface;
  readonly input: Validator<Parsed, Input>;
  /** What it does, in Japanese: the MCP tool description, word for word. */
  readonly description: string;
  readonly tool?: OperationTool;
  readonly target: OperationTarget;
  /** Starts a site build, so the audit entry stays "requested" until it lands. */
  readonly publishes?: boolean;
  /** Type-level only: what the handler returns. */
  readonly __output?: Output;
}

/**
 * `operation<Output>()({...})`: the output type is given, the input types are
 * inferred from the validator.
 */
export const operation =
  <Output>() =>
  <Parsed, Input>(
    spec: Omit<OperationSpec<Parsed, Output, Input>, "__output">,
  ): OperationSpec<Parsed, Output, Input> =>
    spec;

/** The caller's side of an operation, as the API decides who may run it. */
export type OperationChannel = "admin" | "operator" | "analytics";

/** Whether a caller on `channel` may run `spec`. The one rule; nothing else lists paths. */
export function isOperationAllowed(
  spec: Pick<OperationSpec, "kind" | "surface">,
  channel: OperationChannel,
  allowWrites: boolean,
): boolean {
  if (channel === "admin") return true;
  if (spec.surface !== channel) return false;
  if (spec.kind === "read") return true;
  return spec.kind === "write" && allowWrites;
}
