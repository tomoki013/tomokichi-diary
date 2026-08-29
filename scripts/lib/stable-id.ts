import { createHash } from "node:crypto";

/**
 * Deterministic identifiers for imported content.
 *
 * A re-run of the import must produce the same ids, otherwise every export
 * diff would be noise and re-importing would duplicate rows. Shaped like a
 * UUID so it is indistinguishable from an id the application generates.
 */
export function stableId(kind: string, key: string): string {
  const hex = createHash("sha256").update(`${kind}:${key}`).digest("hex").slice(0, 32);
  const version = `8${hex.slice(13, 16)}`; // UUID v8: explicitly application-defined
  const variant = ((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80)
    .toString(16)
    .padStart(2, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${version}-${variant}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}
