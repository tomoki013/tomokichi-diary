import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../lib/markdown";

describe("renderMarkdown", () => {
  it("escapes HTML and drops unsafe link targets", () => {
    const { html } = renderMarkdown(
      "<script>alert(1)</script> [x](javascript:alert(1)) [y](//evil.example)",
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain('href="//evil');
  });
});
