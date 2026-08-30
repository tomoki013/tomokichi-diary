import { describe, expect, it } from "vitest";
import {
  acceptContactSubmission,
  isRateLimited,
  looksLikeSpam,
  validateContactSubmission,
} from "../rules/contact.js";
import type { ContactMessage } from "../entities/contact-message.js";
import { NOW, at } from "./fixtures.js";

const valid = {
  name: "ともきち",
  email: "reader@example.com",
  subject: "記事の感想",
  body: "CHAGEEの記事、とても参考になりました。",
};

const message = (createdAt: string): ContactMessage =>
  ({
    ...valid,
    id: "m1",
    ipHash: "abc",
    status: "unread",
    createdAt: at(createdAt),
  }) as ContactMessage;

describe("validateContactSubmission", () => {
  it("accepts a well-formed submission", () => {
    expect(validateContactSubmission(valid)).toEqual([]);
  });

  it("requires every field", () => {
    const errors = validateContactSubmission({ name: " ", email: "", subject: "", body: "" });
    expect(errors.map((e) => e.field)).toEqual(["name", "email", "subject", "body"]);
  });

  it.each(["no-at-sign", "missing@domain", "@example.com", "spaces in@example.com"])(
    "rejects the address %s",
    (email) => {
      expect(validateContactSubmission({ ...valid, email }).some((e) => e.field === "email")).toBe(
        true,
      );
    },
  );

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

describe("looksLikeSpam", () => {
  it("passes an ordinary message", () => {
    expect(looksLikeSpam(valid)).toBe(false);
  });

  it("flags link floods and bbcode or html link markup", () => {
    expect(
      looksLikeSpam({ ...valid, body: "https://a.com https://b.com https://c.com https://d.com" }),
    ).toBe(true);
    expect(looksLikeSpam({ ...valid, body: "[url=https://a.com]click[/url]" })).toBe(true);
    expect(looksLikeSpam({ ...valid, body: '<a href="https://a.com">click</a>' })).toBe(true);
  });

  it("does not flag a message that cites one or two sources", () => {
    expect(
      looksLikeSpam({ ...valid, body: "参考: https://example.com と https://example.org です。" }),
    ).toBe(false);
  });
});

describe("isRateLimited", () => {
  it("allows a first submission", () => {
    expect(isRateLimited(null, NOW)).toBe(false);
  });

  it("blocks a second submission inside the window and allows it after", () => {
    expect(isRateLimited(message("2026-08-30T00:00:30.000Z"), NOW)).toBe(true);
    expect(isRateLimited(message("2026-08-29T23:58:00.000Z"), NOW)).toBe(false);
  });
});

describe("acceptContactSubmission", () => {
  it("reports validation problems before rate limiting", () => {
    const result = acceptContactSubmission({
      input: { ...valid, email: "nope" },
      previous: message("2026-08-30T00:00:30.000Z"),
      now: NOW,
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]?.code).toBe("API_VALIDATION_FAILED");
  });

  it("rejects a too-fast resubmission with a conflict", () => {
    const result = acceptContactSubmission({
      input: valid,
      previous: message("2026-08-30T00:00:30.000Z"),
      now: NOW,
    });
    expect(!result.ok && result.errors[0]?.code).toBe("API_CONFLICT");
  });

  it("accepts an otherwise valid submission", () => {
    expect(acceptContactSubmission({ input: valid, previous: null, now: NOW }).ok).toBe(true);
  });
});
