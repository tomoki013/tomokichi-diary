import type { AppContext } from "@tomokichi/application";
import type {
  ErrorCode,
  OperationChannel,
  OperationName,
  OperationOutput,
  OperationParsed,
  SitePublicationStatus,
  ValidationIssue,
} from "@tomokichi/contracts";
import type { DomainError } from "@tomokichi/domain";
import type { SqlDatabase } from "@tomokichi/infra-d1";
import type { ProjectOperatorClient } from "@inquiry-platform/sdk";
import type { AuditContext } from "../audit.js";
import type { Env } from "../env.js";

export type OpStatus = 400 | 401 | 403 | 404 | 409 | 429 | 500 | 502 | 503;

/** A refusal with a stable code: the route turns it into the API's one error shape. */
export class OpError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: OpStatus,
    readonly issues?: readonly ValidationIssue[],
  ) {
    super(message);
  }
}

/** Everything a handler may touch. Handlers never see the HTTP request. */
export interface OpScope {
  readonly ctx: AppContext;
  readonly env: Env;
  /** Who passed the gate, as other systems' audit logs name them. */
  readonly actor: string;
  readonly audit: AuditContext;
  readonly channel: OperationChannel;
  /** Asks for a site build; `deferBuild` records the request without starting one. */
  publishSite(deferBuild?: boolean): Promise<SitePublicationStatus>;
  /** The inquiry platform client, or null where it is not bound. */
  inquiry(): ProjectOperatorClient | null;
  /** The database, for the few tables that have no repository. */
  db(): SqlDatabase;
  /** A file sent as multipart instead of Base64 (`media.upload`). */
  readonly upload?: {
    readonly body: ArrayBuffer;
    readonly mimeType: string;
    readonly name: string;
  };
}

export type Handler<N extends OperationName> = (
  scope: OpScope,
  input: OperationParsed<N>,
) => Promise<OperationOutput<N>>;

/** Every operation has exactly one handler; a missing one does not compile. */
export type Handlers<Names extends OperationName = OperationName> = {
  [N in Names]: Handler<N>;
};

const STATUS_BY_CODE: Partial<Record<ErrorCode, OpStatus>> = {
  API_VALIDATION_FAILED: 400,
  API_UNAUTHORIZED: 401,
  API_FORBIDDEN: 403,
  API_NOT_FOUND: 404,
  API_CONFLICT: 409,
  ARTICLE_NOT_FOUND: 404,
  REVISION_NOT_FOUND: 404,
  ROUTE_NOT_FOUND: 404,
  MEDIA_NOT_FOUND: 404,
  COLLECTION_NOT_FOUND: 404,
  RANKING_NOT_FOUND: 404,
  ARTICLE_NOT_PUBLISHABLE: 409,
  SEO_IMAGE_ALT_MISSING: 400,
};

/** Domain failures carry their own code, so the HTTP status follows from it. */
export function domainError(errors: readonly DomainError[]): OpError {
  const first = errors[0];
  if (!first) return new OpError("API_INTERNAL", "unknown error", 500);
  return new OpError(
    first.code,
    errors.map((error) => error.message).join("; "),
    STATUS_BY_CODE[first.code] ?? 400,
    errors.map((error) => ({ path: error.field ?? "", message: error.message })),
  );
}

/** The value of a use case's result, or its failure as an `OpError`. */
export function unwrap<T>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly errors: readonly DomainError[] },
): T {
  if (!result.ok) throw domainError(result.errors);
  return result.value;
}

/** For use cases whose result type is not inferred: the caller names what comes back. */
export function unwrapAs<T>(
  result:
    | { readonly ok: true; readonly value: unknown }
    | { readonly ok: false; readonly errors: readonly DomainError[] },
): T {
  if (!result.ok) throw domainError(result.errors);
  return result.value as T;
}

export const notFound = (code: ErrorCode, message: string): OpError =>
  new OpError(code, message, 404);
export const invalid = (message: string, path = ""): OpError =>
  new OpError("API_VALIDATION_FAILED", message, 400, [{ path, message }]);
