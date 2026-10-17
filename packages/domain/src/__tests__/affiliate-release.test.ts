import { expect, it } from "vitest";
import { isAffiliateUrl, type AffiliateOffer } from "@tomokichi/contracts";
import {
  publicMonetization,
  defaultArticleMonetization,
  DEFAULT_MONETIZATION_SETTINGS,
} from "../index.js";
const offer: AffiliateOffer = {
  id: "private-offer",
  name: "PRIVATE_NAME",
  provider: "Trip.com",
  category: "PRIVATE_CATEGORY",
  heading: "旅行の予約先を確認",
  description: "条件を比較してください。",
  url: "https://www.trip.com/t/FixtureLink",
  imageUrl: null,
  format: "booking_card",
  notes: "PRIVATE_NOTE",
  status: "ready",
  checkedAt: "2026-10-17T00:00:00.000Z",
  publicationApproved: true,
  updatedAt: null,
};
const config = {
  ...defaultArticleMonetization(),
  mode: "hybrid" as const,
  placements: [
    ...defaultArticleMonetization().placements,
    {
      key: "booking",
      kind: "affiliate" as const,
      position: "article_end" as const,
      status: "ready" as const,
      adUnit: "7152502134",
      offerId: offer.id,
    },
  ],
};
const settings = { ...DEFAULT_MONETIZATION_SETTINGS, affiliateEnabled: true };
it("publishes only the approved presentation while preserving the existing AdSense baseline", () => {
  const result = publicMonetization("article", config, settings, null, [offer]);
  expect(result.placement?.adUnit).toBe("7152502134");
  expect(result.affiliates).toEqual([
    {
      key: "booking",
      position: "article_end",
      provider: offer.provider,
      heading: offer.heading,
      description: offer.description,
      url: offer.url,
      format: offer.format,
    },
  ]);
  expect(JSON.stringify(result)).not.toMatch(
    /PRIVATE_|private-offer|publicationApproved|checkedAt/,
  );
});
it("requires independent site, article, placement and checked offer approval", () => {
  for (const changed of [
    { publicationApproved: false },
    { publicationApproved: undefined },
    { checkedAt: null },
    { status: "draft" as const },
    { status: "paused" as const },
    { status: "archived" as const },
    { url: null },
    { url: "https://example.com/ad" },
    { heading: "" },
    { format: "photo_card" as const },
  ])
    expect(
      publicMonetization("article", config, settings, null, [{ ...offer, ...changed }]).affiliates,
    ).toBeUndefined();
  expect(
    publicMonetization("article", config, DEFAULT_MONETIZATION_SETTINGS, null, [offer]).affiliates,
  ).toBeUndefined();
  expect(
    publicMonetization("article", { ...config, mode: "ads" }, settings, null, [offer]).affiliates,
  ).toBeUndefined();
  expect(
    publicMonetization(
      "article",
      { ...config, placements: [{ ...config.placements[1]!, status: "paused" }] },
      settings,
      null,
      [offer],
    ).affiliates,
  ).toBeUndefined();
});
it("allows verified network link shapes and rejects spoofed hosts, credentials and bad destinations", () => {
  expect(
    isAffiliateUrl(
      "Agoda",
      "https://www.agoda.com/partners/partnersearch.aspx?pcs=1&cid=1234&hl=ja-jp&city=9395",
    ),
  ).toBe(true);
  expect(isAffiliateUrl("Omio", "https://omio.sjv.io/FixtureLink")).toBe(true);
  for (const url of [
    "javascript:alert(1)",
    "http://www.trip.com/t/abc",
    "https://www.trip.com.evil.test/t/abc",
    "https://a:b@www.trip.com/t/abc",
    "https://www.trip.com:444/t/abc",
    "https://www.trip.com/redirect?to=evil",
  ])
    expect(isAffiliateUrl("Trip.com", url)).toBe(false);
  expect(isAffiliateUrl("Agoda", "https://www.agoda.com/partners/partnersearch.aspx?cid=-1")).toBe(
    false,
  );
  expect(isAffiliateUrl("Omio", "https://omio.sjv.io/abc?u=https%3A%2F%2Fevil.test")).toBe(false);
});
