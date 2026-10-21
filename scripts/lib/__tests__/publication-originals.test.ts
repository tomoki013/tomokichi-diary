import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { downloadOriginals } from "../media-originals.js";
import { loadSnapshot } from "../built-site.js";
describe("content-addressed original recovery", () => {
  it("verifies local and cached checksums and downloads only missing originals", async () => {
    const dir = mkdtempSync(join(tmpdir(), "publication-originals-"));
    try {
      const body = Buffer.from("test original");
      const hash = createHash("sha256").update(body).digest("hex");
      const snapshot = loadSnapshot();
      const media = { ...snapshot.media[0]!, storageKey: "test.jpg", contentSha256: hash };
      const value = { ...snapshot, media: [media] };
      const options = {
        mediaDir: join(dir, "media"),
        cacheDir: join(dir, "cache"),
        download: vi.fn(async () => body),
      };
      expect(await downloadOriginals(value, options)).toEqual({ cached: 0, downloaded: 1 });
      expect(await downloadOriginals(value, options)).toEqual({ cached: 1, downloaded: 0 });
      rmSync(join(dir, "media/test.jpg"));
      expect(await downloadOriginals(value, options)).toEqual({ cached: 1, downloaded: 0 });
      expect(readFileSync(join(dir, "media/test.jpg"))).toEqual(body);
      writeFileSync(join(dir, "media/test.jpg"), "corrupt");
      writeFileSync(join(dir, "cache", hash), "corrupt");
      expect(await downloadOriginals(value, options)).toEqual({ cached: 0, downloaded: 1 });
      expect(options.download).toHaveBeenCalledTimes(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
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
