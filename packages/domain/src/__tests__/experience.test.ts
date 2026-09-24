import { describe, expect, it } from "vitest";
import { EXPERIENCE_TAGS, isExperienceTag, parseExperienceTags } from "../entities/experience.js";

describe("experience tags", () => {
  it("normalises to a de-duplicated list in vocabulary order", () => {
    const parsed = parseExperienceTags(["unforgettable", "exciting", "unforgettable"]);
    expect(parsed).toEqual({ ok: true, value: ["exciting", "unforgettable"] });
  });

  it("rejects values outside the vocabulary instead of dropping them", () => {
    const parsed = parseExperienceTags(["exciting", "絶景"]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors[0]?.field).toBe("experienceTags");
  });

  it("accepts an empty list as 'not tagged yet'", () => {
    expect(parseExperienceTags([])).toEqual({ ok: true, value: [] });
  });

  it("keeps identifiers URL- and YAML-safe", () => {
    for (const tag of EXPERIENCE_TAGS) {
      expect(tag).toMatch(/^[a-z]+$/);
      expect(isExperienceTag(tag)).toBe(true);
    }
    expect(isExperienceTag("Exciting")).toBe(false);
  });
});
