import { expect, it } from "vitest";
import {
  AFFILIATE_ENABLED,
  AFFILIATE_RELEASE_APPROVED,
  DEFAULT_MONETIZATION_SETTINGS,
  defaultArticleMonetization,
  publicMonetization,
} from "../index.js";
const config = {
  ...defaultArticleMonetization(),
  placements: [
    {
      key: "stable-key",
      kind: "adsense" as const,
      position: "marker" as const,
      status: "ready" as const,
      adUnit: "7152502134",
      offerId: null,
    },
  ],
};
it("does not expose unapproved affiliate offers even with the global flag enabled", () => {
  expect(AFFILIATE_ENABLED && AFFILIATE_RELEASE_APPROVED).toBe(true);
  expect(DEFAULT_MONETIZATION_SETTINGS.affiliateEnabled).toBe(false);
  const result = publicMonetization(
    "article",
    {
      ...defaultArticleMonetization(),
      mode: "affiliate",
      placements: [{ ...config.placements[0]!, kind: "affiliate", offerId: "SECRET" }],
    },
    {
      ...DEFAULT_MONETIZATION_SETTINGS,
      affiliateEnabled: true,
    } as unknown as typeof DEFAULT_MONETIZATION_SETTINGS,
    null,
  );
  expect(result.placement).toBeNull();
  expect(JSON.stringify(result)).not.toContain("SECRET");
});
