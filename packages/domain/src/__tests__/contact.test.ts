import { describe, expect, it } from "vitest";
import { validateContactSubmission } from "../rules/contact.js";

const valid = {
  name: "ともきち",
  email: "reader@example.com",
  subject: "記事の感想",
  body: "CHAGEEの記事、とても参考になりました。",
};

describe("validateContactSubmission", () => {
  it("accepts a well-formed submission", () => {
    expect(validateContactSubmission(valid)).toEqual([]);
  });

  it("requires every field", () => {
    const errors = validateContactSubmission({ name: " ", email: "", subject: "", body: "" });
    expect(errors.map((e) => e.field)).toEqual(["name", "email", "subject", "body"]);
  });

  it.each(["no-at-sign", "missing@domain"])("rejects the address %s", (email) => {
    expect(validateContactSubmission({ ...valid, email }).some((e) => e.field === "email")).toBe(
      true,
    );
  });

  it("rejects a body that is too short and one that is too long", () => {
    expect(
      validateContactSubmission({ ...valid, body: "短い" }).some((e) => e.field === "body"),
    ).toBe(true);
    expect(
      validateContactSubmission({ ...valid, body: "あ".repeat(4001) }).some(
        (e) => e.field === "body",
      ),
    ).toBe(true);
  });

  it("caps the remaining fields", () => {
    expect(validateContactSubmission({ ...valid, name: "あ".repeat(101) })).toHaveLength(1);
    expect(validateContactSubmission({ ...valid, subject: "あ".repeat(151) })).toHaveLength(1);
  });
});
