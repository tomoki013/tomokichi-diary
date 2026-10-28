import { it, expect } from "vitest";
import {
  buildExportFiles,
  parseExportFiles,
  EMPTY_SNAPSHOT,
  publicMonetizationOnly,
} from "../index.js";
import type { PublicMonetization } from "@tomokichi/contracts";
it("repeats the public allowlist on export and import, independent of affiliate flags", () => {
  const raw = {
    articleId: "test",
    enabled: true,
    placement: {
      key: "safe-key",
      position: "article_end",
      adUnit: "7152502134",
      url: "SECRET_URL",
    },
    experiment: null,
    affiliateEnabled: true,
    offers: [{ name: "SECRET_NAME" }],
  } as unknown as PublicMonetization;
  const files = buildExportFiles({ ...EMPTY_SNAPSHOT, monetization: [raw] });
  expect(JSON.stringify(files)).not.toContain("SECRET_");
  expect(JSON.stringify(files)).not.toContain("affiliateEnabled");
  const snapshot = parseExportFiles((path) =>
    path === "monetization.json" ? JSON.stringify([raw]) : null,
  );
  expect(snapshot.monetization).toEqual(publicMonetizationOnly([raw]));
  expect(JSON.stringify(snapshot)).not.toContain("SECRET_");
});
it("rechecks approved presentation and strips private fields at both export boundaries", () => {
  const affiliate = {
    key: "booking",
    position: "article_end",
    provider: "Trip.com",
    heading: "予約を比較",
    description: "掲載する説明",
    url: "https://www.trip.com/t/FixtureLink",
    format: "booking_card",
    notes: "SECRET_NOTE",
    offerId: "SECRET_ID",
  };
  const raw = {
    articleId: "article",
    enabled: false,
    placement: null,
    experiment: null,
    affiliates: [affiliate],
  } as unknown as PublicMonetization;
  const result = publicMonetizationOnly([raw]);
  expect(result[0]?.affiliates).toHaveLength(1);
  expect(JSON.stringify(result)).not.toContain("SECRET_");
  for (const url of ["https://evil.test/", "javascript:alert(1)"])
    expect(
      publicMonetizationOnly([
        { ...raw, affiliates: [{ ...affiliate, url }] } as PublicMonetization,
      ])[0]?.affiliates,
    ).toBeUndefined();
  expect(
    publicMonetizationOnly([
      { ...raw, affiliates: [affiliate, affiliate] } as PublicMonetization,
    ])[0]?.affiliates,
  ).toBeUndefined();
});
