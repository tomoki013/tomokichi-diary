import type { Context } from "hono";
import type { ErrorBody, ErrorCode, ValidationIssue } from "@tomokichi/contracts";
import type { DomainError } from "@tomokichi/domain";

/** One error shape for the whole API, keyed by a stable code (instruction §79). */
export function errorResponse(
  c: Context,
  code: ErrorCode,
  message: string,
  status: 400 | 401 | 403 | 404 | 409 | 500,
  issues?: readonly ValidationIssue[],
): Response {
  const body: ErrorBody = {
    error: {
      code,
      message,
      requestId: c.get("requestId") as string,
      ...(issues ? { issues } : {}),
    },
  };
  return c.json(body, status);
}

const STATUS_BY_CODE: Partial<Record<ErrorCode, 400 | 401 | 403 | 404 | 409 | 500>> = {
  API_VALIDATION_FAILED: 400,
  API_UNAUTHORIZED: 401,
  API_FORBIDDEN: 403,
  API_NOT_FOUND: 404,
  API_CONFLICT: 409,
  ARTICLE_NOT_FOUND: 404,
  REVISION_NOT_FOUND: 404,
  ROUTE_NOT_FOUND: 404,
  MEDIA_NOT_FOUND: 404,
  ARTICLE_NOT_PUBLISHABLE: 409,
  SEO_IMAGE_ALT_MISSING: 400,
};

/** Domain failures carry their own code, so the HTTP status follows from it. */
export function domainErrorResponse(c: Context, errors: readonly DomainError[]): Response {
  const first = errors[0];
  if (!first) return errorResponse(c, "API_INTERNAL", "unknown error", 500);
  return errorResponse(
    c,
    first.code,
    errors.map((error) => error.message).join("; "),
    STATUS_BY_CODE[first.code] ?? 400,
    errors.map((error) => ({ path: error.field ?? "", message: error.message })),
  );
}
