import { describe, expect, it } from "vitest";
import type { ArticleReadingDto } from "@tomokichi/contracts";
import { reviewReasons } from "./analytics-review";

const row = (over: Partial<ArticleReadingDto>): ArticleReadingDto => ({
  articleId: "a",
  path: "/posts/a",
  pageViews: 100,
  measuredViews: 90,
  body75Rate: 0.4,
  bodyEndRate: 0.3,
  nextArticleRate: 0.1,
  clicks: 50,
  clicksPrevious: 50,
  impressions: 1000,
  position: 5,
  positionPrevious: 5,
  earningsJPY: 10,
  ...over,
});
const now = Date.parse("2026-10-30T00:00:00Z");

describe("articles worth another look", () => {
  it("lists a search fall, a slip in position and a year without edits", () => {
    expect(
      reviewReasons(
        row({ clicks: 30, clicksPrevious: 50, position: 8, positionPrevious: 5 }),
        "2025-09-01T00:00:00Z",
        now,
      ),
    ).toEqual(["検索クリック 50→30", "平均順位 5→8", "読まれているのに424日更新なし"]);
  });

  it("leaves steady, recently edited articles alone", () => {
    expect(reviewReasons(row({}), "2026-10-01T00:00:00Z", now)).toEqual([]);
    expect(reviewReasons(row({ clicks: 1, clicksPrevious: 5 }), null, now)).toEqual([]);
  });
});
