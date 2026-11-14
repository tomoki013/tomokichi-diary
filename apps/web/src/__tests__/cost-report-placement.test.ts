import { renderArticleMarkdown } from "@tomokichi/contracts";
import { expect, it } from "vitest";
import { placeCostReport } from "../lib/cost-report-placement";

const marker = "{{embed:cost-report}}";

it("moves the imported report between the cost section introduction and its currency table", () => {
  const html = renderArticleMarkdown(
    `## 費用総括\n\nすべて一人分です。\n\n| 項目 | 円 |\n| --- | --- |\n| 宿泊 | 1,000円 |\n\n## 詳細旅程\n\n本文です。\n\n${marker}`,
  );
  const placed = placeCostReport(html);

  expect(placed).toMatch(/一人分です。<\/p>\s*<p>\{\{embed:cost-report\}\}<\/p>\s*<table>/);
  expect(placed.split(marker)).toHaveLength(2);
});

it("leaves explicit placements and articles without a matching cost heading intact", () => {
  const explicit = renderArticleMarkdown(`## 費用一覧\n\n${marker}\n\n金額は一人分です。`);
  const noHeading = renderArticleMarkdown(`## 旅程\n\n本文です。\n\n${marker}`);

  expect(placeCostReport(explicit)).toBe(explicit);
  expect(placeCostReport(noHeading)).toBe(noHeading);
});
