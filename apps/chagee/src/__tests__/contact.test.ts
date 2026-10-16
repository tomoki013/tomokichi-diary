import { describe, expect, it } from "vitest";
import { readContactForm, toSubmission, validateContact } from "../lib/contact";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

describe("contact form", () => {
  const valid = {
    name: "ともきち",
    email: "a@example.com",
    kind: "correction",
    body: "営業時間が変わっていました。",
    url: "",
  };

  it("accepts a complete submission", () => {
    expect(validateContact(readContactForm(form(valid)))).toEqual({});
  });

  it("reports each invalid field", () => {
    const errors = validateContact(
      readContactForm(form({ ...valid, name: " ", email: "x", body: "短い", url: "javascript:1" })),
    );
    expect(Object.keys(errors).toSorted()).toEqual(["body", "email", "name", "url"]);
  });

  it("falls back to その他 for an unknown kind", () => {
    expect(readContactForm(form({ ...valid, kind: "<script>" })).kind).toBe("other");
  });

  it("puts the kind in the subject and the URL after the body", () => {
    const submission = toSubmission(
      readContactForm(form({ ...valid, url: "https://chagee.tomokichidiary.com/stores/kl-wolo" })),
    );
    expect(submission.subject).toBe("[CHAGEEガイド] 情報修正");
    expect(submission.message).toMatch(
      /\n\n関連URL: https:\/\/chagee\.tomokichidiary\.com\/stores\/kl-wolo$/,
    );
  });
});
