import { describe, expect, it } from "vitest";
import { positionB } from "./ad-test";

const paragraph = (n: number) => `段落${n}の終わり。${"旅の記録を書いています。".repeat(12)}`;
const body = [
  "導入です。",
  "## 見出し",
  ...Array.from({ length: 4 }, (_, i) => paragraph(i)),
  "{{monetization:body-ad}}",
  ...Array.from({ length: 10 }, (_, i) => paragraph(i + 4)),
].join("\n\n");

describe("where B's body ad goes", () => {
  it("picks a paragraph well away from A's", () => {
    const spot = positionB(body, "body-ad")!;
    const a = body.indexOf("{{monetization:body-ad}}") / body.length;
    expect(Math.abs(spot.fraction - a)).toBeGreaterThanOrEqual(0.15);
  });

  it("takes the paragraph the author names, and refuses one the rule rejects", () => {
    expect(positionB(body, "body-ad", "書いています。")).not.toBeNull();
    expect(positionB(body, "body-ad", "導入です")).toBeNull();
  });
});
