import { describe, expect, it } from "vitest";
import type { PublicMonetization } from "@tomokichi/contracts";
import { buildAdPlan } from "../lib/monetization";

const paragraph = (n: number) => `段落${n}。${"旅の記録を書いています。".repeat(12)}`;
const body = [
  "導入です。",
  "## 見出し",
  ...Array.from({ length: 4 }, (_, i) => paragraph(i)),
  "{{monetization:body-ad}}",
  ...Array.from({ length: 4 }, (_, i) => paragraph(i + 4)),
  "{{monetization:body-ad-b}}",
  ...Array.from({ length: 4 }, (_, i) => paragraph(i + 8)),
].join("\n\n");
const id = "52b1cb6d-eb74-85a3-b6a1-392f83313051";
const config = (experiment: PublicMonetization["experiment"]): PublicMonetization => ({
  articleId: id,
  enabled: true,
  placement: { key: "article-end", position: "article_end", adUnit: "7152502134" },
  inline: null,
  experiment,
});
const test = {
  id: `placement-v1-${id}-r2`,
  markerKey: "body-ad-b",
  adUnitA: "7152502134",
  adUnitB: "7152502134",
  shareB: 50,
};

describe("ad plan for a position test", () => {
  it("gives both arms the end ad and each its own body ad", () => {
    const plan = buildAdPlan(config({ ...test, markerKeyA: "body-ad" }), body);
    expect(plan.end).toEqual({ unit: "7152502134", variant: "static" });
    expect(plan.marker).toEqual({ key: "body-ad-b", unit: "7152502134", variant: "B" });
    expect(plan.markerA).toEqual({ key: "body-ad", unit: "7152502134", variant: "A" });
  });

  it("keeps an older test's A on the end ad alone", () => {
    expect(buildAdPlan(config(test), body).markerA).toBeNull();
  });

  it("does not run a test whose A and B share one position", () => {
    const plan = buildAdPlan(config({ ...test, markerKeyA: "body-ad-b" }), body);
    expect(plan.experiment).toBeNull();
  });
});
