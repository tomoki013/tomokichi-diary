/**
 * Stable error codes.
 *
 * These strings are a public contract: runbooks (docs/OPERATIONS.md), CI
 * summaries and API responses are keyed by them. Wording of messages may
 * change freely; codes may not. Adding is fine, renaming is a breaking change.
 */
export const ERROR_CODES = [
  // --- Pipeline ---
  "FORMAT_CHECK_FAILED",
  "LINT_FAILED",
  "TYPECHECK_FAILED",
  "TEST_FAILED",
  "BUILD_FAILED",
  "BOUNDARY_VIOLATION",
  "KNOWLEDGE_VALIDATION_FAILED",

  // --- Routes ---
  "ROUTE_LEGACY_MISSING",
  "ROUTE_DUPLICATE_PATH",
  "ROUTE_TARGET_MISSING",
  "ROUTE_REDIRECT_LOOP",

  // --- SEO ---
  "SEO_TITLE_MISSING",
  "SEO_DESCRIPTION_MISSING",
  "SEO_CANONICAL_MISSING",
  "SEO_CANONICAL_MISMATCH",
  "SEO_H1_MISSING",
  "SEO_H1_DUPLICATE",
  "SEO_NOINDEX_REGRESSION",
  "SEO_SITEMAP_MISMATCH",
  "SEO_JSONLD_INVALID",
  "SEO_IMAGE_ALT_MISSING",

  // --- Links ---
  "LINK_INTERNAL_BROKEN",

  // --- Performance ---
  "PERF_SCORE",
  "PERF_LCP",
  "PERF_CLS",
  "PERF_TBT",
  "PERF_REGRESSION",

  // --- Data / infrastructure ---
  "DB_MIGRATION_FAILED",
  "EXPORT_FAILED",
  "IMPORT_FAILED",

  // --- API ---
  "API_VALIDATION_FAILED",
  "API_UNAUTHORIZED",
  "API_FORBIDDEN",
  "API_NOT_FOUND",
  "API_CONFLICT",
  "API_INTERNAL",

  // --- Domain ---
  "ARTICLE_NOT_FOUND",
  "ARTICLE_NOT_PUBLISHABLE",
  "REVISION_NOT_FOUND",
  "ROUTE_NOT_FOUND",
  "MEDIA_NOT_FOUND",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export function isErrorCode(value: string): value is ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(value);
}
