import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildMedia, plannedDerivatives, type Derivative } from "../../media-build.js";
import { cacheControlFor, requiresUpload, syncMedia } from "../../media-sync.js";
import { loadSnapshot } from "../built-site.js";
import {
  downloadDerivative,
  listRemoteMedia,
  md5,
  type RemoteMediaObject,
} from "../media-remote.js";
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "publication-media-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
const object = (key: string, body: Buffer): RemoteMediaObject => ({
  key,
  size: body.length,
  etag: md5(body),
  http_metadata: { cacheControl: cacheControlFor(key) },
});
async function fixture(): Promise<Derivative> {
  const source = join(dir, "original.png");
  await sharp({ create: { width: 32, height: 24, channels: 3, background: "red" } })
    .png()
    .toFile(source);
  return {
    key: "_img/hash-32.webp",
    source,
    file: join(dir, "hash-32.webp"),
    width: 32,
    format: "webp",
  };
}
describe("publication image cache", () => {
  it("uses identical derivative identities for text, SEO, alt/caption and association changes", () => {
    const snapshot = loadSnapshot();
    const before = plannedDerivatives(snapshot).map((job) => job.key);
    const changed = {
      ...snapshot,
      revisions: snapshot.revisions.map((r) => ({
        ...r,
        title: "new title",
        bodyMarkdown: "new body",
        seoDescriptionOverride: "new SEO",
      })),
      articleMedia: snapshot.articleMedia.map((a) => ({
        ...a,
        alt: "new alt",
        caption: "new caption",
      })),
    };
    expect(plannedDerivatives(changed).map((job) => job.key)).toEqual(before);
    expect(
      plannedDerivatives({
        ...snapshot,
        media: snapshot.media.map((a) => ({ ...a, sha256: "f".repeat(64) })),
      }).map((job) => job.key),
    ).not.toEqual(before);
  });
  it("encodes only new/missing derivatives and reuses warm cache", async () => {
    const job = await fixture();
    expect(await buildMedia([job])).toMatchObject({ generated: 1, cached: 0 });
    expect(await buildMedia([job])).toMatchObject({ generated: 0, cached: 1 });
    const second = { ...job, file: join(dir, "other.webp"), key: "_img/new-32.webp" };
    expect(await buildMedia([job, second])).toMatchObject({ generated: 1, cached: 1 });
  });
  it("recovers a lost or corrupt cache from verified R2 bytes without encoding", async () => {
    const job = await fixture();
    const body = await sharp(job.source).webp({ quality: 74 }).toBuffer();
    const remote = new Map([[job.key, object(job.key, body)]]);
    rmSync(job.source);
    for (const corrupt of [false, true]) {
      if (corrupt) writeFileSync(job.file, "corrupt cache");
      expect(
        await buildMedia([job], {
          remote: true,
          inventory: async () => remote,
          download: async () => body,
        }),
      ).toMatchObject({ restored: 1, generated: 0 });
    }
  });
  it("regenerates when both caches are absent, and fails closed on an unreadable original", async () => {
    const job = await fixture();
    expect(
      await buildMedia([job], { remote: true, inventory: async () => new Map() }),
    ).toMatchObject({ generated: 1 });
    writeFileSync(job.source, "bad original");
    await expect(buildMedia([job], { full: true })).rejects.toThrow("derivatives failed");
  });
});
describe("R2 differential sync", () => {
  it("detects same-sized byte changes, deleted objects and cache header changes", () => {
    const body = Buffer.from("abcd");
    const key = "_img/hash.webp";
    const remote = object(key, body);
    expect(requiresUpload(body, key, remote)).toBe(false);
    expect(requiresUpload(Buffer.from("dcba"), key, remote)).toBe(true);
    expect(requiresUpload(body, key, undefined)).toBe(true);
    expect(
      requiresUpload(body, key, { ...remote, http_metadata: { cacheControl: "no-store" } }),
    ).toBe(true);
    expect(requiresUpload(body, key, remote, true)).toBe(true);
  });
  it("restores missing objects despite a stale manifest and verifies uploads", async () => {
    const job = await fixture();
    await buildMedia([job]);
    const manifestPath = join(dir, "manifest.json");
    writeFileSync(manifestPath, '{"stale":"previously uploaded"}');
    const remote = new Map<string, RemoteMediaObject>();
    const upload = vi.fn(async (item: { key: string; file: string }) => {
      remote.set(item.key, object(item.key, readFileSync(item.file)));
    });
    const options = { manifestPath, inventory: async () => remote, upload };
    expect(await syncMedia([job], options)).toMatchObject({ uploaded: 1 });
    expect(await syncMedia([job], options)).toMatchObject({ uploaded: 0, unchanged: 1 });
    expect(upload).toHaveBeenCalledTimes(1);
    remote.clear();
    await expect(syncMedia([job], { ...options, upload: async () => {} })).rejects.toThrow(
      "verification failed",
    );
  });
  it("recovers partial syncs by re-reading origin on the next execution", async () => {
    const job = await fixture();
    const uploads = [
      { key: "one", file: job.source },
      { key: "two", file: job.source },
    ];
    const remote = new Map<string, RemoteMediaObject>();
    const base = { manifestPath: join(dir, "manifest"), inventory: async () => remote };
    await expect(
      syncMedia(uploads, {
        ...base,
        upload: async (item) => {
          if (item.key === "two") throw new Error("upload unavailable");
          remote.set(item.key, object(item.key, readFileSync(item.file)));
        },
      }),
    ).rejects.toThrow("upload unavailable");
    const upload = vi.fn(async (item: { key: string; file: string }) => {
      remote.set(item.key, object(item.key, readFileSync(item.file)));
    });
    expect(await syncMedia(uploads, { ...base, upload })).toMatchObject({
      uploaded: 1,
      unchanged: 1,
    });
  });
  it("paginates authenticated inventories and rejects a broken cursor or API failure", async () => {
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "test-token");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "test-account");
    const dispatch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          success: true,
          result: [object("one", Buffer.from("1"))],
          result_info: { is_truncated: true, cursor: "next" },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          success: true,
          result: [object("two", Buffer.from("2"))],
          result_info: { is_truncated: false },
        }),
      );
    expect((await listRemoteMedia(dispatch)).size).toBe(2);
    expect(String(dispatch.mock.calls[1]?.[0])).toContain("cursor=next");
    await expect(listRemoteMedia(async () => new Response(null, { status: 403 }))).rejects.toThrow(
      "HTTP 403",
    );
    await expect(
      listRemoteMedia(async () =>
        Response.json({ success: true, result: [], result_info: { is_truncated: true } }),
      ),
    ).rejects.toThrow("cursor");
  });
});

describe("verified derivative cache rehydration", () => {
  it("restores matching CDN bytes without authenticated API calls", async () => {
    const body = Buffer.from("derivative");
    const expected = object("_img/hash.webp", body);
    const dispatch = vi.fn<typeof fetch>(async () => new Response(body));
    expect(await downloadDerivative(expected, dispatch)).toEqual(body);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(String(dispatch.mock.calls[0]?.[0])).toContain("https://media.tomokichidiary.com/");
    expect(dispatch.mock.calls[0]?.[1]?.headers).toBeUndefined();
  });
  it("falls back to authenticated origin for stale, absent or unavailable CDN objects", async () => {
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "test-token");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "test-account");
    const body = Buffer.from("derivative");
    for (const condition of ["stale", "missing", "network"]) {
      const dispatch = vi.fn<typeof fetch>(async (url) => {
        if (String(url).startsWith("https://media.tomokichidiary.com/")) {
          if (condition === "network") throw new Error("offline");
          return condition === "missing"
            ? new Response(null, { status: 404 })
            : new Response("wrong bytes");
        }
        return new Response(body);
      });
      expect(await downloadDerivative(object("_img/hash.webp", body), dispatch)).toEqual(body);
      expect(dispatch).toHaveBeenCalledTimes(2);
      expect(dispatch.mock.calls[1]?.[1]?.headers).toMatchObject({
        authorization: "Bearer test-token",
      });
    }
  });
  it("rejects origin bytes that disagree with the inventory", async () => {
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "test-token");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "test-account");
    expect(
      await downloadDerivative(
        object("_img/hash.webp", Buffer.from("expected")),
        async () => new Response("wrong"),
      ),
    ).toBeNull();
  });
});
