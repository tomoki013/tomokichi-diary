import { describe, expect, it } from "vitest";
import { asId, type TravelFact, type TravelFactId } from "@tomokichi/domain";
import { searchTravelFacts } from "./travel-knowledge.js";

const fact = (overrides: Partial<TravelFact>): TravelFact => ({
  id: asId<TravelFactId>("fact"),
  kind: "observation",
  statement: "ミニバスを実際に利用した。",
  provenance: "firsthand",
  status: "verified",
  experiencedAt: null,
  verifiedAt: null,
  value: null,
  volatility: null,
  articleIds: [],
  placeIds: [],
  sourceIds: [],
  travelRouteId: null,
  verifiedBy: null,
  ...overrides,
});

describe("searchTravelFacts", () => {
  it("returns only verified firsthand facts for a firsthand query", () => {
    const result = searchTravelFacts(
      [
        fact({}),
        fact({ id: asId<TravelFactId>("candidate"), status: "candidate" }),
        fact({ id: asId<TravelFactId>("official"), provenance: "official" }),
      ],
      { text: "ミニバス", provenance: "firsthand" },
    );
    expect(result.map((item) => item.id)).toEqual(["fact"]);
  });
});
