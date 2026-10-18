import { describe, expect, it } from "vitest";
import { enhanceInlineAffiliates } from "./inline-affiliates";

const paragraph =
  '<p>今回は<a href="https://example.com/?a=1&amp;b=2" rel="sponsored nofollow noopener">列車を比較しました</a>。\n<small class="affiliate-inline-disclosure">広告：予約条件をご確認ください。</small></p>';
describe("inline affiliate approval", () => {
  it("keeps an approved link and its disclosure, including escaped query strings", () => {
    expect(enhanceInlineAffiliates(paragraph, ["https://example.com/?a=1&b=2"])).toBe(paragraph);
  });
  it("preserves the prose and removes links and disclosures when disabled or unapproved", () => {
    expect(enhanceInlineAffiliates(paragraph, [])).toBe("<p>今回は列車を比較しました。\n</p>");
    expect(enhanceInlineAffiliates(paragraph, ["https://other.example.com"])).toBe(
      "<p>今回は列車を比較しました。\n</p>",
    );
  });
  it("leaves ordinary source and internal links unchanged", () => {
    const ordinary =
      '<p><a href="./other">旅行記</a>と<a href="https://example.com/terms">利用規約</a></p>';
    expect(enhanceInlineAffiliates(ordinary, [])).toBe(ordinary);
  });
});
