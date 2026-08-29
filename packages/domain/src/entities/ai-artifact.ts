import type { AIArtifactId, RevisionId } from "../primitives/id.js";
import type { Instant } from "../primitives/datetime.js";

export const AI_ARTIFACT_KINDS = [
  "summary",
  "keyword_suggestion",
  "internal_link_suggestion",
  "seo_audit",
  "content_audit",
  "fact_check_result",
] as const;
export type AIArtifactKind = (typeof AI_ARTIFACT_KINDS)[number];

/**
 * Sidecar data. Generated output is a suggestion until a human adopts it into a
 * revision; nothing here is ever a source of truth (ADR 0004).
 */
export interface AIArtifact {
  readonly id: AIArtifactId;
  readonly entityType: "article" | "location" | "place" | "route";
  readonly entityId: string;
  /** The revision the output was derived from, so staleness is detectable. */
  readonly sourceRevisionId: RevisionId | null;
  readonly kind: AIArtifactKind;
  readonly content: Readonly<Record<string, unknown>>;
  readonly createdAt: Instant;
  /** Opaque label such as `internal-link-suggester@3`; never a vendor SDK type. */
  readonly generator: string;
}
