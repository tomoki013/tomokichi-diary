import type {
  ArticleKnowledge,
  SourceReference,
  TravelFact,
  TravelRoute,
} from "../entities/knowledge.js";
import type { AuthorId } from "../primitives/id.js";

export interface KnowledgeIssue {
  readonly code:
    | "FIRSTHAND_REQUIRES_EXPERIENCE_DATE"
    | "FIRSTHAND_REQUIRES_HUMAN_VERIFIER"
    | "OFFICIAL_REQUIRES_SOURCE_AND_DATE"
    | "BROKEN_KNOWLEDGE_REFERENCE"
    | "DUPLICATE_KNOWLEDGE_ID"
    | "FUTURE_EXPERIENCE_DATE"
    | "STALE_CURRENT_FACT"
    | "INVALID_DECISION_TABLE";
  readonly target: string;
  readonly message: string;
}

export function verifyFirsthandFact(
  fact: TravelFact,
  actor: { readonly kind: "human" | "ai" | "system"; readonly authorId: AuthorId | null },
  verifiedAt: TravelFact["verifiedAt"],
): TravelFact {
  if (fact.provenance !== "firsthand") throw new Error("only firsthand facts use this workflow");
  if (actor.kind !== "human" || actor.authorId === null) {
    throw new Error("verified firsthand facts require a human-authorized action");
  }
  if (fact.experiencedAt === null) throw new Error("firsthand facts require experiencedAt");
  return { ...fact, status: "verified", verifiedAt, verifiedBy: actor.authorId };
}

export function validateKnowledgeGraph(input: {
  readonly sources: readonly SourceReference[];
  readonly travelRoutes: readonly TravelRoute[];
  readonly travelFacts: readonly TravelFact[];
  readonly articleKnowledge: readonly ArticleKnowledge[];
  readonly articleIds: ReadonlySet<string>;
  readonly revisionIds: ReadonlySet<string>;
  readonly placeIds: ReadonlySet<string>;
  readonly today: string;
}): KnowledgeIssue[] {
  const issues: KnowledgeIssue[] = [];
  const ids = (values: readonly { readonly id: string }[], kind: string) => {
    const seen = new Set<string>();
    for (const value of values) {
      if (seen.has(value.id))
        issues.push({
          code: "DUPLICATE_KNOWLEDGE_ID",
          target: value.id,
          message: `duplicate ${kind} id`,
        });
      seen.add(value.id);
    }
    return seen;
  };
  const sourceIds = ids(input.sources, "source");
  const sourceById = new Map(input.sources.map((source) => [source.id, source]));
  const routeIds = ids(input.travelRoutes, "travel route");
  const factIds = ids(input.travelFacts, "travel fact");

  for (const fact of input.travelFacts) {
    if (fact.provenance === "firsthand") {
      if (fact.experiencedAt === null)
        issues.push({
          code: "FIRSTHAND_REQUIRES_EXPERIENCE_DATE",
          target: fact.id,
          message: "firsthand facts require experiencedAt",
        });
      if (fact.status === "verified" && fact.verifiedBy === null)
        issues.push({
          code: "FIRSTHAND_REQUIRES_HUMAN_VERIFIER",
          target: fact.id,
          message: "verified firsthand facts require a human verifier",
        });
    }
    if (
      fact.provenance === "official" &&
      fact.status === "verified" &&
      (fact.verifiedAt === null ||
        fact.sourceIds.length === 0 ||
        fact.sourceIds.some((id) => {
          const source = sourceById.get(id);
          return source?.type !== "official" || !source.url || !source.checkedAt;
        }))
    ) {
      issues.push({
        code: "OFFICIAL_REQUIRES_SOURCE_AND_DATE",
        target: fact.id,
        message: "verified official facts require verifiedAt and a dated official source URL",
      });
    }
    if (fact.experiencedAt !== null && fact.experiencedAt > input.today)
      issues.push({
        code: "FUTURE_EXPERIENCE_DATE",
        target: fact.id,
        message: "experiencedAt cannot be in the future",
      });
    if (
      fact.kind === "current_fact" &&
      fact.status === "verified" &&
      fact.verifiedAt !== null &&
      fact.volatility !== null
    ) {
      const ageDays = Math.floor(
        (Date.parse(`${input.today}T00:00:00Z`) - Date.parse(`${fact.verifiedAt}T00:00:00Z`)) /
          86_400_000,
      );
      const maxAge = fact.volatility === "high" ? 90 : fact.volatility === "medium" ? 365 : 730;
      if (ageDays > maxAge)
        issues.push({
          code: "STALE_CURRENT_FACT",
          target: fact.id,
          message: `${fact.volatility}-volatility current fact was last checked ${ageDays} days ago`,
        });
    }
    for (const id of fact.articleIds)
      if (!input.articleIds.has(id))
        issues.push({
          code: "BROKEN_KNOWLEDGE_REFERENCE",
          target: fact.id,
          message: `missing article ${id}`,
        });
    for (const id of fact.placeIds)
      if (!input.placeIds.has(id))
        issues.push({
          code: "BROKEN_KNOWLEDGE_REFERENCE",
          target: fact.id,
          message: `missing place ${id}`,
        });
    for (const id of fact.sourceIds)
      if (!sourceIds.has(id))
        issues.push({
          code: "BROKEN_KNOWLEDGE_REFERENCE",
          target: fact.id,
          message: `missing source ${id}`,
        });
    if (fact.travelRouteId !== null && !routeIds.has(fact.travelRouteId))
      issues.push({
        code: "BROKEN_KNOWLEDGE_REFERENCE",
        target: fact.id,
        message: `missing travel route ${fact.travelRouteId}`,
      });
  }

  for (const knowledge of input.articleKnowledge) {
    if (!input.articleIds.has(knowledge.articleId))
      issues.push({
        code: "BROKEN_KNOWLEDGE_REFERENCE",
        target: knowledge.articleId,
        message: "article knowledge references a missing article",
      });
    if (!input.revisionIds.has(knowledge.revisionId))
      issues.push({
        code: "BROKEN_KNOWLEDGE_REFERENCE",
        target: knowledge.articleId,
        message: `missing revision ${knowledge.revisionId}`,
      });
    const usedFacts = [
      ...knowledge.experienceGroups.flatMap((group) => group.factIds),
      ...knowledge.currentFactIds,
      ...knowledge.cautionFactIds,
    ];
    for (const id of usedFacts)
      if (!factIds.has(id))
        issues.push({
          code: "BROKEN_KNOWLEDGE_REFERENCE",
          target: knowledge.articleId,
          message: `missing travel fact ${id}`,
        });
    for (const id of knowledge.routeIds)
      if (!routeIds.has(id))
        issues.push({
          code: "BROKEN_KNOWLEDGE_REFERENCE",
          target: knowledge.articleId,
          message: `missing travel route ${id}`,
        });
    for (const relation of knowledge.relatedArticles)
      if (!input.articleIds.has(relation.articleId))
        issues.push({
          code: "BROKEN_KNOWLEDGE_REFERENCE",
          target: knowledge.articleId,
          message: `missing related article ${relation.articleId}`,
        });
    if (
      knowledge.decisionTable &&
      knowledge.decisionTable.rows.some(
        (row) => row.values.length !== knowledge.decisionTable!.columns.length - 1,
      )
    )
      issues.push({
        code: "INVALID_DECISION_TABLE",
        target: knowledge.articleId,
        message: "decision table rows must match the declared columns",
      });
  }
  return issues;
}
