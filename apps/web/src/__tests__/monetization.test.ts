import { expect, it } from "vitest";
import { buildAdPlan } from "../lib/monetization";
import type { PublicMonetization } from "@tomokichi/contracts";
const body = `導入\n\n## 回答\n\n${"内容".repeat(400)}\n\n{{monetization:answer-end}}\n\n続き`;
const config: PublicMonetization = {
  articleId: "52b1cb6d-eb74-85a3-b6a1-392f83313051",
  enabled: true,
  placement: { key: "article-end", position: "article_end", adUnit: "7152502134" },
  experiment: {
    id: "chagee-placement-v1",
    markerKey: "answer-end",
    adUnitA: "7152502134",
    adUnitB: "1234567890",
    shareB: 50,
  },
};
it("keeps old exports at the original single end unit", () => {
  expect(buildAdPlan(undefined, body)).toMatchObject({
    layout: "article-end-v1",
    end: { unit: "7152502134" },
    marker: null,
    experiment: null,
  });
});
it("builds one requestable A/B pair only for the allowlisted article and provides build kill switches", () => {
  expect(buildAdPlan(config, body)).toMatchObject({
    end: { variant: "A" },
    marker: { variant: "B", key: "answer-end" },
  });
  expect(buildAdPlan(config, body, { placements: true, experiments: false }).experiment).toBeNull();
  expect(buildAdPlan(config, body, { placements: false, experiments: false }).layout).toBe(
    "article-end-v1",
  );
  expect(buildAdPlan({ ...config, articleId: "other" }, body).experiment).toBeNull();
});
it("fails closed on missing markers, duplicates, short body and injected units", () => {
  for (const markdown of [
    body.replace("{{monetization:answer-end}}", ""),
    body + "\n\n{{monetization:answer-end}}",
    "{{monetization:answer-end}}",
  ]) {
    const plan = buildAdPlan(config, markdown);
    expect(plan.end).toBeNull();
    expect(plan.marker).toBeNull();
  }
  expect(
    buildAdPlan({ ...config, experiment: { ...config.experiment!, adUnitA: "<script>" } }, body)
      .end,
  ).toBeNull();
  expect(buildAdPlan({ ...config, enabled: false }, body)).toMatchObject({
    end: null,
    marker: null,
    experiment: null,
  });
});
