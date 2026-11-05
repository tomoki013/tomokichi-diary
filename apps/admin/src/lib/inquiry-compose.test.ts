import { describe, expect, it } from "vitest";
import { replaceReplyOpening } from "./inquiry-compose";

describe("reply identity", () => {
  const old = "お客様 様\n\nともきちの旅行日記を運営しております、ともきちです。";
  const next = "お客様 様\n\nともきちの旅行日記を運営しております、髙木です。";
  it("switches the introduction and preserves the answer", () => {
    expect(replaceReplyOpening(`${old}\n\n回答です。`, old, next)).toBe(`${next}\n\n回答です。`);
  });
  it("keeps a recipient name edited by the operator", () => {
    const edited = old.replace("お客様", "田中");
    expect(replaceReplyOpening(`${edited}\n\n回答です。`, old, next)).toBe(
      `${next.replace("お客様", "田中")}\n\n回答です。`,
    );
  });
});
