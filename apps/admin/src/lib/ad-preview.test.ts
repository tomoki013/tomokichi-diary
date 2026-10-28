import { describe, expect, it } from "vitest";
import { marked } from "marked";
import type { ArticleMonetization } from "@tomokichi/contracts";
import { markersToPlaceholders, withAdMocks, type AdPreview } from "./ad-preview";

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
  offers: [{ id: "o1", name: "Trip", heading: "Trip.comで比較する", provider: "Trip.com" }],
  testMarker: null,
  ...patch,
});
const render = (body: string, p: AdPreview | null) =>
  withAdMocks(marked.parse(markersToPlaceholders(body), { async: false }) as string, p);
const body =
  "本文。\n\n{{monetization:body-ad}}\n\n続き。\n\n{{monetization:slot-a}}\n\n{{monetization:old}}\n";

describe("withAdMocks", () => {
  it("never shows the raw marker and draws each slot as readers get it", () => {
    const html = render(body, preview());
    expect(html).not.toContain("{{monetization");
    expect(html).toContain("本文中 300×250");
    expect(html).toContain("Trip.comで比較する");
    expect(html).toContain("一時停止中");
    expect(html.trimEnd().endsWith("</aside>")).toBe(true);
    expect(html).toContain("記事末尾 300×250");
  });

  it("shows a test's B slot even though it is stored paused, and hides other body ads", () => {
    const html = render(body.replace("old", "body-test-v1"), {
      ...preview({ testMarker: "body-test-v1" }),
      config: config({
        placements: [
          end,
          { ...end, key: "body-ad", position: "marker" },
          { ...end, key: "body-test-v1", position: "marker", status: "paused" },
        ],
      }),
    });
    expect(html).toContain("テストのB");
    expect(html).toContain("テスト中はBの枠だけが出ます");
  });

  it("draws no ad at all when ads are off, and neutral slots before the settings load", () => {
    const off = render(body, preview({ config: config({ mode: "affiliate", adsEnabled: false }) }));
    expect(off).not.toContain("記事末尾");
    expect(off).toContain("広告なしの設定");
    expect(render(body, null)).toContain("ad-mock--unknown");
  });

  it("escapes offer text", () => {
    const html = render(
      body,
      preview({ offers: [{ id: "o1", name: "x", heading: "<b>x</b>", provider: "P" }] }),
    );
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});
