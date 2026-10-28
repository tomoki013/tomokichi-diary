import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { downloadOriginals } from "../media-originals.js";
import { loadSnapshot } from "../built-site.js";
describe("content-addressed original recovery", () => {
  it("rejects traversal, missing objects and mismatched remote checksums", async () => {
    const dir = mkdtempSync(join(tmpdir(), "publication-originals-"));
    try {
      mkdirSync(join(dir, "media"));
      const snapshot = loadSnapshot();
      const asset = snapshot.media[0]!;
      const options = {
        mediaDir: join(dir, "media"),
        cacheDir: join(dir, "cache"),
        download: async () => Buffer.from("incorrect"),
      };
      await expect(
        downloadOriginals(
          { ...snapshot, media: [{ ...asset, storageKey: "../outside" }] },
          options,
        ),
      ).rejects.toThrow("storage key");
      await expect(
        downloadOriginals({ ...snapshot, media: [{ ...asset, storageKey: "absent" }] }, options),
      ).rejects.toThrow("Missing or corrupt");
      await expect(
        downloadOriginals(
          { ...snapshot, media: [{ ...asset, storageKey: "absent" }] },
          { ...options, download: async () => null },
        ),
      ).rejects.toThrow("Missing or corrupt");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
