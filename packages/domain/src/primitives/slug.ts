import type { Brand } from "./brand.js";
import { err, ok, type Result } from "./result.js";

/**
 * Editorial identifier. Deliberately *not* the URL: routes are independent data
 * (see docs/adr/0002-route-independent-from-slug.md), so renaming a slug never
 * moves a published page.
 */
export type Slug = Brand<string, "Slug">;

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 96;

export function parseSlug(value: string): Result<Slug> {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    return err({ code: "API_VALIDATION_FAILED", message: "slug must not be empty", field: "slug" });
  }
  if (normalized.length > MAX_SLUG_LENGTH) {
    return err({
      code: "API_VALIDATION_FAILED",
      message: `slug must be at most ${MAX_SLUG_LENGTH} characters`,
      field: "slug",
    });
  }
  if (!SLUG_RE.test(normalized)) {
    return err({
      code: "API_VALIDATION_FAILED",
      message: "slug must be lowercase alphanumeric segments joined by single hyphens",
      field: "slug",
    });
  }
  return ok(normalized as Slug);
}

/** Best-effort slug from arbitrary text. Non-latin scripts yield an empty result on purpose. */
export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
}
