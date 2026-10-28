import { describe, expect, it } from "vitest";
import { enhanceInlineAffiliates } from "../lib/inline-affiliates";

const URL = "https://omio.sjv.io/oN3NYe";

describe("enhanceInlineAffiliates", () => {
  it("turns a link marked 広告 into a sponsored link with its disclosure", () => {
    const html = `<p>列車は<a href="${URL}" title="広告">Omioで探す</a>と早いです。</p>`;
    expect(enhanceInlineAffiliates(html, [URL])).toBe(
      `<p>列車は<a href="${URL}" rel="sponsored nofollow noopener">Omioで探す</a>と早いです。\n<small class="affiliate-inline-disclosure">広告：このリンク経由の予約で当サイトが報酬を受け取る場合があります。料金・条件は予約先でご確認ください。</small></p>`,
    );
  });

  it("leaves only the label when the placement is not approved", () => {
    const html = `<p>列車は<a href="${URL}" title="広告">Omioで探す</a>と早いです。</p>`;
    expect(enhanceInlineAffiliates(html, [])).toBe("<p>列車はOmioで探すと早いです。</p>");
  });

  it("keeps bodies that still carry the rel and note as HTML", () => {
    const html = `<p><a href="${URL}" rel="sponsored nofollow noopener">Omio</a>\n<small class="affiliate-inline-disclosure">広告</small></p>`;
    expect(enhanceInlineAffiliates(html, [URL])).toBe(html);
    expect(enhanceInlineAffiliates(html, [])).toBe("<p>Omio\n</p>");
  });

  it("leaves ordinary links alone", () => {
    const html = '<p><a href="/posts/x" title="関連">記事</a></p>';
    expect(enhanceInlineAffiliates(html, [URL])).toBe(html);
  });
});
