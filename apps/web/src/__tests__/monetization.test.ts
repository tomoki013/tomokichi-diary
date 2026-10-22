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
it("tests adding a body ad on top of the fixed end ad, only for the allowlisted article", () => {
  expect(buildAdPlan(config, body)).toMatchObject({
    end: { variant: "static", unit: "7152502134" },
    marker: { variant: "B", key: "answer-end" },
  });
  expect(buildAdPlan(config, body, { placements: true, experiments: false }).experiment).toBeNull();
  expect(buildAdPlan(config, body, { placements: false, experiments: false }).layout).toBe(
    "article-end-v1",
  );
  expect(buildAdPlan({ ...config, articleId: "other" }, body).experiment).toBeNull();
});
it("keeps only the end ad when an experiment cannot run: missing or duplicate markers, short body, injected units", () => {
  for (const markdown of [
    body.replace("{{monetization:answer-end}}", ""),
    body + "\n\n{{monetization:answer-end}}",
    "{{monetization:answer-end}}",
  ]) {
    const plan = buildAdPlan(config, markdown);
    expect(plan.end).toMatchObject({ unit: "7152502134", variant: "static" });
    expect(plan.marker).toBeNull();
    expect(plan.experiment).toBeNull();
  }
  expect(
    buildAdPlan({ ...config, experiment: { ...config.experiment!, adUnitA: "<script>" } }, body),
  ).toMatchObject({ end: { unit: "7152502134" }, marker: null, experiment: null });
  expect(buildAdPlan({ ...config, enabled: false }, body)).toMatchObject({
    end: null,
    marker: null,
    experiment: null,
  });
});
it("builds an article-bound experiment on a second article without changing the original trial", () => {
  const articleId = "ea3bf3bc-ffb6-84ed-8147-188ed74d7a50";
  const expanded = {
    ...config,
    articleId,
    experiment: { ...config.experiment!, id: `placement-v1-${articleId}` },
  };
  expect(buildAdPlan(expanded, body)).toMatchObject({
    end: { variant: "static" },
    marker: { variant: "B" },
    experiment: { id: expanded.experiment.id },
  });
  expect(buildAdPlan({ ...expanded, articleId: config.articleId }, body).experiment).toBeNull();
  expect(buildAdPlan(config, body).experiment?.id).toBe("chagee-placement-v1");
});
it("renders approved affiliate positions independently of AdSense and rejects bad markers and URLs", async () => {
  const { buildAffiliatePlan } = await import("../lib/monetization");
  const p = {
    key: "answer-end",
    position: "marker" as const,
    provider: "Trip.com",
    heading: "予約先の確認",
    description: "最新条件を確認",
    url: "https://www.trip.com/t/FixtureLink",
    format: "booking_card" as const,
  };
  const affiliateOnly = {
    ...config,
    enabled: false,
    placement: null,
    experiment: null,
    affiliates: [p],
  };
  expect(buildAffiliatePlan(affiliateOnly, body)).toEqual([p]);
  expect(buildAffiliatePlan(affiliateOnly, body, false)).toEqual([]);
  expect(
    buildAffiliatePlan(affiliateOnly, body.replace("{{monetization:answer-end}}", "")),
  ).toEqual([]);
  expect(buildAffiliatePlan(affiliateOnly, body + "\n\n{{monetization:answer-end}}")).toEqual([]);
  expect(buildAffiliatePlan(affiliateOnly, "{{monetization:answer-end}}")).toEqual([]);
  expect(buildAffiliatePlan({ ...config, affiliates: [p] }, body)).toEqual([]); // never share the AdSense marker
  expect(
    buildAffiliatePlan(
      { ...affiliateOnly, affiliates: [{ ...p, url: "https://evil.test/" }] },
      body,
    ),
  ).toEqual([]);
});

it("keeps the end ad on every article outside experiments and adds a valid body ad", () => {
  const plain = { ...config, experiment: null };
  expect(buildAdPlan({ ...plain, placement: null }, body)).toMatchObject({
    layout: "article-end-v1",
    end: { unit: "7152502134", variant: "static" },
    marker: null,
  });
  expect(
    buildAdPlan({ ...plain, inline: { key: "answer-end", adUnit: "1234567890" } }, body),
  ).toMatchObject({
    layout: "article-placement-v2",
    end: { unit: "7152502134", variant: "static" },
    marker: { key: "answer-end", unit: "1234567890", variant: "static" },
  });
  // A snapshot from before inline ads, with its one ad in the body, gains the end ad.
  expect(
    buildAdPlan(
      { ...plain, placement: { key: "answer-end", position: "marker", adUnit: "1234567890" } },
      body,
    ),
  ).toMatchObject({ end: { unit: "7152502134" }, marker: { key: "answer-end" } });
  // A body ad that does not fit drops alone; the end ad stays.
  expect(
    buildAdPlan(
      { ...plain, inline: { key: "answer-end", adUnit: "1234567890" } },
      body.replace("{{monetization:answer-end}}", ""),
    ),
  ).toMatchObject({ end: { unit: "7152502134" }, marker: null });
});
