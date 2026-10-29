import { describe, expect, it } from "vitest";
import {
  bodyAdPlacementProblem,
  enhanceInlineAffiliates,
  renderArticleMarkdown,
  replaceLoneLinks,
  visibleTextLength,
} from "../article-markdown.js";

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

describe("renderArticleMarkdown", () => {
  it("renders like the site's former renderer: curly quotes, dashes and Astro's heading ids", () => {
    expect(renderArticleMarkdown(`## Touch 'n Goの話\n\n"日本"の -- 旅... it's`)).toBe(
      '<h2 id="touch-n-goの話">Touch ’n Goの話</h2>\n<p>“日本”の – 旅… it’s</p>\n',
    );
  });

  it("leaves code and attributes alone", () => {
    expect(renderArticleMarkdown('`"x" -- y` [a "b"](/c "広告")')).toBe(
      '<p><code>&quot;x&quot; -- y</code> <a href="/c" title="広告">a “b”</a></p>\n',
    );
  });
});

describe("replaceLoneLinks", () => {
  it("offers only a paragraph or list item that is one link", () => {
    const html = renderArticleMarkdown("[カード](/posts/a)\n\n文中の[リンク](/posts/b)です");
    expect(replaceLoneLinks(html, (href) => `<aside>${href}</aside>`)).toBe(
      '<aside>/posts/a</aside>\n<p>文中の<a href="/posts/b">リンク</a>です</p>\n',
    );
  });
});

describe("visibleTextLength", () => {
  it("counts what a reader reads, not URLs, photos, cards, players or syntax", () => {
    expect(visibleTextLength("## 見出し\n\n本文**です**。")).toBe(8);
    const noise = [
      "![写真の説明](https://media.tomokichidiary.com/images/a-very-long-file-name.jpg)",
      "[記事カード](/posts/some-article)",
      "https://music.apple.com/jp/album/x/1?i=2",
      "{{monetization:body-ad}}",
      "{{embed:cost-report}}",
    ].join("\n\n");
    expect(visibleTextLength(noise)).toBe(0);
    expect(visibleTextLength("| 項目 | 内容 |\n| --- | --- |\n| 料金 | 無料 |")).toBe(8);
    expect(visibleTextLength("文中の[リンク](https://example.com/long/path)です")).toBe(8);
  });
});

describe("bodyAdPlacementProblem", () => {
  const prose = "読".repeat(600);
  it("asks for a heading and 600 visible characters before the ad", () => {
    expect(bodyAdPlacementProblem(`## 見出し\n\n${prose}\n\n`, "\n\n続き")).toBeNull();
    expect(bodyAdPlacementProblem(`${prose}\n\n`, "\n\n続き")).toBe("introduction");
    const padded = `## 見出し\n\n${"読".repeat(300)}\n\n![${"x".repeat(400)}](https://x/${"y".repeat(400)}.jpg)\n\n本文。\n\n`;
    expect(bodyAdPlacementProblem(padded, "\n\n続き")).toBe("introduction");
  });

  it("keeps the ad away from photos, embeds and link cards", () => {
    expect(bodyAdPlacementProblem(`## 見出し\n\n${prose}\n\n![写真](/a.jpg)\n\n`, "\n\n続き")).toBe(
      "neighbour",
    );
    expect(bodyAdPlacementProblem(`## 見出し\n\n${prose}\n\n`, "\n\n[カード](/posts/a)")).toBe(
      "neighbour",
    );
  });
});
