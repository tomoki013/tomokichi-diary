import { describe, expect, it } from "vitest";
import {
  asId,
  verifyFirsthandFact,
  validateKnowledgeGraph,
  type ArticleId,
  type AuthorId,
  type PlainDate,
  type SourceId,
  type TravelFact,
  type TravelFactId,
} from "../index.js";

const candidate: TravelFact = {
  id: asId<TravelFactId>("fact-1"),
  kind: "visit",
  statement: "実際に訪れた。",
  provenance: "firsthand",
  status: "candidate",
  experiencedAt: "2025-06-20" as PlainDate,
  verifiedAt: null,
  value: null,
  volatility: null,
  articleIds: [asId<ArticleId>("article-1")],
  placeIds: [],
  sourceIds: [asId<SourceId>("source-1")],
  travelRouteId: null,
  verifiedBy: null,
};

describe("travel knowledge", () => {
  it("does not let AI verify a firsthand candidate", () => {
    expect(() =>
      verifyFirsthandFact(candidate, { kind: "ai", authorId: null }, "2026-09-04" as PlainDate),
    ).toThrow(/human-authorized/);
  });

  it("records the human identity when firsthand evidence is verified", () => {
    const authorId = asId<AuthorId>("author-1");
    expect(
      verifyFirsthandFact(candidate, { kind: "human", authorId }, "2026-09-04" as PlainDate),
    ).toMatchObject({ status: "verified", verifiedBy: authorId });
  });

  it("detects a missing evidence source", () => {
    const issues = validateKnowledgeGraph({
      sources: [],
      travelRoutes: [],
      travelFacts: [candidate],
      articleKnowledge: [],
      articleIds: new Set(["article-1"]),
      revisionIds: new Set(),
      placeIds: new Set(),
      today: "2026-09-04",
    });
    expect(issues.map((issue) => issue.code)).toContain("BROKEN_KNOWLEDGE_REFERENCE");
  });
});
