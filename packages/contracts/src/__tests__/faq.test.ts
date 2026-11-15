import { describe, expect, it } from "vitest";
import { faqProblems, formatFaqMarkdown, parseFaqMarkdown } from "../faq.js";

const body = `## 記事について

### どこから読めばいい？

トップの「新着」からどうぞ。

[記事一覧](/posts)もあります。

### 写真は使っていい？

無断転載はできません。

## お問い合わせ

### 売却の相談はできますか？

お受けしていません。
`;

describe("FAQ Markdown", () => {
  it("reads categories, questions and multi-paragraph answers", () => {
    expect(parseFaqMarkdown(body)).toEqual([
      {
        title: "記事について",
        items: [
          {
            question: "どこから読めばいい？",
            answer: "トップの「新着」からどうぞ。\n\n[記事一覧](/posts)もあります。",
          },
          { question: "写真は使っていい？", answer: "無断転載はできません。" },
        ],
      },
      {
        title: "お問い合わせ",
        items: [{ question: "売却の相談はできますか？", answer: "お受けしていません。" }],
      },
    ]);
  });

  it("writes back exactly what it read", () => {
    expect(formatFaqMarkdown(parseFaqMarkdown(body))).toBe(body);
  });

  it("drops empty rows and empty categories when writing", () => {
    expect(
      formatFaqMarkdown([
        {
          title: "A",
          items: [
            { question: "Q", answer: "答え" },
            { question: " ", answer: "" },
          ],
        },
        { title: "", items: [] },
      ]),
    ).toBe("## A\n\n### Q\n\n答え\n");
  });

  it("names what is missing", () => {
    expect(
      faqProblems([
        { title: "", items: [{ question: "Q", answer: "a" }] },
        {
          title: "B",
          items: [
            { question: "", answer: "a" },
            { question: "Q2", answer: "" },
            { question: "Q3", answer: "## x" },
          ],
        },
      ]),
    ).toHaveLength(4);
  });
});
