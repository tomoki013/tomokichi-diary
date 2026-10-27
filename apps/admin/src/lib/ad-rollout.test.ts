import { expect, it } from "vitest";
import { suggestAdParagraph } from "./ad-rollout";
const body = `導入文。\n\n## 回答\n\n${"体験の説明です。".repeat(75)}\n\n${"回答を伝える段落です。".repeat(12)}\n\n## 続きを読む\n\n${"残りの体験を説明します。".repeat(100)}`;
it("selects prose after sufficient content, never inside code, lists, images or related cards", () => {
  const position = suggestAdParagraph(body);
  expect(position).not.toBeNull();
  expect(position!.fraction).toBeGreaterThanOrEqual(0.3);
  expect(suggestAdParagraph("短い記事\n\n## 回答\n\n本文。")).toBeNull();
  expect(suggestAdParagraph(`## 回答\n\n\`\`\`\n${body}\n\`\`\``)).toBeNull();
  expect(suggestAdParagraph(`## 回答\n\n${"![画像](x.jpg)\n\n".repeat(300)}`)).toBeNull();
});
