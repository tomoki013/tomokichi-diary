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

describe("site-wide anchor test", () => {
  it("uses one shared body slot from a migrated position test", () => {
    const plan = buildAdPlan(config({ ...test, markerKeyA: "body-ad" }), body);
    expect(plan.end).toEqual({ unit: "7152502134" });
    expect(plan.marker).toEqual({ key: "body-ad", unit: "7152502134" });
    expect(plan.experiment).toBe("anchor-v1");
  });

  it("creates the default layout from a published body without any saved configuration", () => {
    const original = body.replace(/\{\{monetization:[^}]+\}\}/g, "");
    const plan = buildAdPlan(undefined, original);
    expect(plan.marker?.key).toBe("body-ad");
    expect(plan.markdown).toContain("{{monetization:body-ad}}");
    expect(plan.end?.unit).toBe("7152502134");
    expect(plan.experiment).toBe("anchor-v1");
  });

  it("enrolls short articles with just their end slot", () => {
    const plan = buildAdPlan(config(test), "短い記事です。");
    expect(plan.marker).toBeNull();
    expect(plan.end?.unit).toBe("7152502134");
    expect(plan.experiment).toBe("anchor-v1");
  });

  it("keeps the common baseline when the test is stopped, and respects global and per-article opt-outs", () => {
    const standard = buildAdPlan(config(test), body);
    expect(buildAdPlan(config(test), body, { placements: true, experiments: false })).toEqual({
      ...standard,
      experiment: null,
    });
    for (const plan of [
      buildAdPlan({ ...config(test), enabled: false }, body),
      buildAdPlan(undefined, body, { placements: true, experiments: true, adsEnabled: false }),
    ])
      expect(plan).toMatchObject({ marker: null, end: null, experiment: null });
  });
});
