import { describe, expect, it } from "vitest";
import { renderArticleMarkdown } from "@tomokichi/contracts";
import type { ArticleMonetization } from "@tomokichi/contracts";
import {
  approvedInlineAffiliateUrls,
  markersToPlaceholders,
  withAdMocks,
  type AdPreview,
} from "./ad-preview";

const end = {
  key: "article-end",
  kind: "adsense",
  position: "article_end",
  status: "ready",
  adUnit: "7152502134",
  offerId: null,
} as const;
const config = (patch: Partial<ArticleMonetization> = {}): ArticleMonetization => ({
  mode: "hybrid",
  adsEnabled: true,
  maxAds: 1,
  experimentId: null,
  placements: [
    end,
    { ...end, key: "body-ad", position: "marker" },
    { ...end, key: "slot-a", kind: "affiliate", position: "marker", offerId: "o1" },
    { ...end, key: "old", position: "marker", status: "paused" },
  ],
  updatedAt: null,
  ...patch,
});
const preview = (patch: Partial<AdPreview> = {}): AdPreview => ({
  config: config(),
  offers: [
    {
      id: "o1",
      name: "Trip",
      heading: "Trip.comで比較する",
      provider: "Trip.com",
      url: "https://www.trip.com/t/x",
      status: "ready",
      publicationApproved: true,
    },
  ],
  testMarker: null,
  ...patch,
});
const render = (body: string, p: AdPreview | null) =>
  withAdMocks(renderArticleMarkdown(markersToPlaceholders(body)), p);
const body =
  "本文。\n\n{{monetization:body-ad}}\n\n続き。\n\n{{monetization:slot-a}}\n\n{{monetization:old}}\n";

describe("withAdMocks", () => {
  it("escapes offer text", () => {
    const html = render(
      body,
      preview({
        offers: [
          {
            id: "o1",
            name: "x",
            heading: "<b>x</b>",
            provider: "P",
            url: null,
            status: "ready",
            publicationApproved: true,
          },
        ],
      }),
    );
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});

describe("approvedInlineAffiliateUrls", () => {
  it("lists the offers readers get as inline links, as the page decides them", () => {
    expect(approvedInlineAffiliateUrls(preview())).toEqual(["https://www.trip.com/t/x"]);
    expect(approvedInlineAffiliateUrls(null)).toEqual([]);
    const paused = preview({
      config: config({
        placements: [
          {
            ...end,
            key: "slot-a",
            kind: "affiliate",
            position: "marker",
            offerId: "o1",
            status: "paused",
          },
        ],
      }),
    });
    expect(approvedInlineAffiliateUrls(paused)).toEqual([]);
  });
});
