import { describe, expect, it } from "vitest";
import { plainText, renderMarkdown } from "../lib/markdown";

describe("renderMarkdown", () => {
  it("renders headings with ids, paragraphs, lists, bold and links", () => {
    const { html, headings } = renderMarkdown(
      "## 結論\n\n本文**強調**と[注文ガイド](/order)。\n\n- 一つ目\n- 二つ目\n\n1. 手順\n2. 次",
    );
    expect(headings).toEqual([{ id: "h-1", text: "結論", level: 2 }]);
    expect(html).toContain('<h2 id="h-1">結論</h2>');
    expect(html).toContain("<strong>強調</strong>");
    expect(html).toContain('<a href="/order">注文ガイド</a>');
    expect(html).toContain("<ul><li>一つ目</li><li>二つ目</li></ul>");
    expect(html).toContain("<ol><li>手順</li><li>次</li></ol>");
  });

  it("opens external links in a new tab", () => {
    expect(renderMarkdown("[NBC](https://www.nbcnews.com/x)").html).toContain(
      '<a href="https://www.nbcnews.com/x" rel="noopener" target="_blank">NBC</a>',
    );
  });

  it("escapes HTML and drops unsafe link targets", () => {
    const { html } = renderMarkdown(
      "<script>alert(1)</script> [x](javascript:alert(1)) [y](//evil.example)",
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain('href="//evil');
  });

  it("strips Markdown for plain text", () => {
    expect(plainText("## 見出し\n**太字**と[リンク](/a)")).toBe("見出し 太字とリンク");
  });
});
