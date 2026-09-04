import { describe, expect, it } from "vitest";
import { queryCatalog } from "../catalog";

describe("public MCP catalog", () => {
  it("returns only verified firsthand evidence for firsthand queries", () => {
    const entries = queryCatalog({ provenance: "firsthand" });
    expect(entries.length).toBeGreaterThan(0);
    expect(
      entries.flatMap((entry) => entry.facts).some((fact) => fact.provenance === "firsthand"),
    ).toBe(true);
    expect(
      entries.flatMap((entry) => entry.facts).every((fact) => fact.provenance === "firsthand"),
    ).toBe(true);
  });
});
