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
