import { expect, it } from "vitest";
import { validate, articleMonetizationSchema } from "@tomokichi/contracts";
import {
  AFFILIATE_ENABLED,
  AFFILIATE_RELEASE_APPROVED,
  DEFAULT_MONETIZATION_SETTINGS,
  assignAdVariant,
  defaultArticleMonetization,
  monetizationMarkers,
  publicMonetization,
  validateMonetization,
} from "../index.js";
const body = `導入\n\n## 回答\n\n${"説明".repeat(400)}\n\n{{monetization:stable-key}}\n\n続きを読む。`;
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
it("keeps stable keys after heading edits and catches duplicates or lost markers", () => {
  expect(validateMonetization(config, body, DEFAULT_MONETIZATION_SETTINGS)).toEqual([]);
  expect(
    validateMonetization(
      config,
      body.replace("## 回答", "## 見出しを変更"),
      DEFAULT_MONETIZATION_SETTINGS,
    ),
  ).toEqual([]);
  expect(
    validateMonetization(
      config,
      body + "\n\n{{monetization:stable-key}}",
      DEFAULT_MONETIZATION_SETTINGS,
    ),
  ).not.toEqual([]);
  expect(
    validateMonetization(
      config,
      body.replace("{{monetization:stable-key}}", ""),
      DEFAULT_MONETIZATION_SETTINGS,
    ),
  ).not.toEqual([]);
  expect(monetizationMarkers("```md\n{{monetization:stable-key}}\n```\n")).toEqual([]);
});
it("rejects first-view, introduction, image adjacency, injected keys and extra active slots", () => {
  expect(
    validateMonetization(
      config,
      "{{monetization:stable-key}}\n\n導入",
      DEFAULT_MONETIZATION_SETTINGS,
    ).length,
  ).toBeGreaterThan(0);
  expect(
    validateMonetization(
      config,
      body.replace("{{monetization", "![写真](image.jpg)\n\n{{monetization"),
      DEFAULT_MONETIZATION_SETTINGS,
    ).length,
  ).toBeGreaterThan(0);
  expect(
    validateMonetization(
      { ...config, placements: [...config.placements, ...config.placements] },
      body,
      DEFAULT_MONETIZATION_SETTINGS,
    ).length,
  ).toBeGreaterThan(0);
  expect(
    validate(articleMonetizationSchema, {
      ...config,
      placements: [{ ...config.placements[0], key: "<script>alert(1)</script>" }],
    }).ok,
  ).toBe(false);
  expect(validate(articleMonetizationSchema, { ...config, maxAds: 2 }).ok).toBe(false);
});
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
it("assigns each draw to one variant with approximate 50/50 and explicit boundary behavior", () => {
  expect(assignAdVariant(50, 0)).toBe("B");
  expect(assignAdVariant(50, 0.49999)).toBe("B");
  expect(assignAdVariant(50, 0.5)).toBe("A");
  expect(assignAdVariant(50, NaN)).toBe("A");
  expect(
    Array.from({ length: 1000 }, (_, i) => assignAdVariant(50, i / 1000)).filter((x) => x === "B"),
  ).toHaveLength(500);
});
