import { describe, expect, it } from "vitest";
import { v, validate } from "../validation.js";

const draft = v.object({
  title: v.string({ min: 1, max: 120 }),
  summary: v.string({ min: 1 }),
  bodyMarkdown: v.string({ min: 1 }),
  seoTitleOverride: v.nullable(v.string()),
  tags: v.optional(v.array(v.string(), { max: 3 }), []),
  status: v.literalUnion(["draft", "published"] as const),
});

describe("validate", () => {
  it("accepts a well-formed body and fills in optionals", () => {
    const result = validate(draft, {
      title: "題名",
      summary: "要約",
      bodyMarkdown: "本文",
      seoTitleOverride: null,
      status: "draft",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tags).toEqual([]);
    expect(result.value.seoTitleOverride).toBeNull();
  });

  it("reports every problem at once, with paths", () => {
    const result = validate(draft, {
      title: "",
      summary: 5,
      bodyMarkdown: "本文",
      status: "archived",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("API_VALIDATION_FAILED");
    expect(result.issues.map((i) => i.path)).toEqual(["title", "summary", "status"]);
  });

  it("rejects a non-object body rather than coercing it", () => {
    for (const input of ["", 1, null, [], undefined]) {
      expect(validate(draft, input).ok).toBe(false);
    }
  });

  it("enforces array limits and reports the offending index", () => {
    const result = validate(draft, {
      title: "題名",
      summary: "要約",
      bodyMarkdown: "本文",
      seoTitleOverride: null,
      status: "draft",
      tags: ["a", 2],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.path).toBe("tags[1]");
  });

  it("checks numbers, booleans and integers", () => {
    const shape = v.object({ page: v.number({ min: 1, integer: true }), flag: v.boolean() });
    expect(validate(shape, { page: 1, flag: true }).ok).toBe(true);
    expect(validate(shape, { page: 1.5, flag: true }).ok).toBe(false);
    expect(validate(shape, { page: 0, flag: true }).ok).toBe(false);
    expect(validate(shape, { page: 1, flag: "yes" }).ok).toBe(false);
  });
});
