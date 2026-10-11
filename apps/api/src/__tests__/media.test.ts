import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { createTestContext } from "@tomokichi/infra-d1/testing-context";
import {
  backfillMediaHashes,
  createArticle,
  inspectImage,
  loadContentSnapshot,
  recoverMediaUploads,
  setArticleMedia,
  sha256Hex,
  updateMediaSlug,
  uploadMediaWithResult,
  type AppContext,
} from "@tomokichi/application";
import { buildExportFiles, parseExportFiles } from "@tomokichi/data";
import { instantFrom, type AuthorId, type MediaAsset, type MediaId } from "@tomokichi/domain";
import { fixedClock } from "@tomokichi/application";
import { createMemoryStorage } from "@tomokichi/infra-r2";
import { createApp } from "../app.js";
import type { Env } from "../env.js";

const auth = { authorization: "Bearer test", "content-type": "application/json" };
const env = { ADMIN_TOKEN: "test", PUBLIC_IMAGE_URL: "https://api.example/v1/images" } as Env;
let ctx: AppContext;
let app: ReturnType<typeof createApp>;
let bytes: ArrayBuffer;
const image = async (color = "red", format: "jpeg" | "png" | "webp" | "avif" | "gif" = "png") =>
  Uint8Array.from(
    await sharp({ create: { width: 4, height: 3, channels: 4, background: color } })
      .toFormat(format)
      .toBuffer(),
  ).buffer;
const input = (body = bytes, name = "photo.png", slug?: string) => ({
  body,
  originalName: name,
  mimeType: "image/png",
  ...(slug ? { slug } : {}),
});
const request = (path: string, init: RequestInit = {}) => app.request(`/v1${path}`, init, env);
async function post(body = bytes, name = "photo.png", type = "image/png", slug?: string) {
  const form = new FormData();
  form.append("file", new File([body], name, { type }));
  // Untrusted client dimensions must not be stored.
  form.append("width", "99999999");
  if (slug) form.append("slug", slug);
  return request("/admin/media", {
    method: "POST",
    headers: { authorization: auth.authorization },
    body: form,
  });
}
async function asset(): Promise<MediaAsset> {
  const result = await uploadMediaWithResult(ctx, input());
  if (!result.ok) throw new Error("fixture failed");
  return result.value.asset;
}
async function article(slug: string) {
  const result = await createArticle(ctx, {
    slug,
    locale: "ja",
    authorId: "author-tomokichi" as AuthorId,
    path: `/posts/${slug}`,
    draft: { title: slug, summary: "summary", bodyMarkdown: "body" },
  });
  if (!result.ok) throw new Error("fixture failed");
  return result.value.article;
}
beforeEach(async () => {
  ctx = await createTestContext();
  app = createApp({ contextFactory: () => ctx });
  bytes = await image();
});

describe("media upload API", () => {
  it("pauses uploads without changing storage or closing authenticated reads", async () => {
    const put = vi.spyOn(ctx.storage, "put");
    const paused = { ...env, MEDIA_UPLOADS_PAUSED: "1" };
    const response = await app.request(
      "/v1/admin/media",
      {
        method: "POST",
        headers: { authorization: auth.authorization },
        body: "not parsed during maintenance",
      },
      paused,
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(put).not.toHaveBeenCalled();
    expect(await ctx.repos.media.listPendingUploads()).toHaveLength(0);
    expect((await app.request("/v1/admin/media", { headers: auth }, paused)).status).toBe(200);
  });
  it("stores original bytes, real dimensions and filename", async () => {
    const response = await post(bytes, "photo.png", "image/png", "tokyo-trip");
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      duplicate: false,
      width: 4,
      height: 3,
      originalName: "photo.png",
      slug: "tokyo-trip",
      hashVerified: true,
      slugUrl: "https://api.example/v1/images/tokyo-trip.png",
    });
    expect(await ctx.repos.media.hashStatus()).toEqual({
      total: 1,
      verified: 1,
      pending: 0,
      uploads: 0,
    });
  });
  it("returns an existing asset for identical bytes regardless of filename", async () => {
    const first = await (await post()).json();
    const second = await post(bytes, "renamed.png");
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({
      id: first.id,
      duplicate: true,
      originalName: "photo.png",
    });
    expect(await ctx.repos.media.listAll()).toHaveLength(1);
  });
  it("stores different bytes with the same name, including re-encoded and resized files", async () => {
    const resized = Uint8Array.from(
      await sharp(new Uint8Array(bytes)).resize(2).png().toBuffer(),
    ).buffer;
    const reencoded = Uint8Array.from(
      await sharp(new Uint8Array(bytes)).png({ compressionLevel: 0 }).toBuffer(),
    ).buffer;
    for (const body of [bytes, await image("blue"), resized, reencoded])
      expect((await post(body)).status).toBe(201);
    expect(await ctx.repos.media.listAll()).toHaveLength(4);
  });
  it("handles simultaneous uploads with one metadata row and one storage write", async () => {
    const put = vi.spyOn(ctx.storage, "put");
    const responses = await Promise.all([post(), post(bytes, "renamed.png"), post()]);
    const bodies = await Promise.all(responses.map((response) => response.json()));
    expect(responses.map((response) => response.status).toSorted()).toEqual([200, 200, 201]);
    expect(new Set(bodies.map((body) => body.id)).size).toBe(1);
    expect(put).toHaveBeenCalledTimes(1);
    expect(await ctx.repos.media.listAll()).toHaveLength(1);
    expect(await ctx.repos.media.listPendingUploads()).toHaveLength(0);
  });
  it("looks up hashes only after authentication", async () => {
    const saved = await asset();
    expect(
      (
        await request("/admin/media/lookup", {
          method: "POST",
          body: JSON.stringify({ sha256: saved.sha256 }),
        })
      ).status,
    ).toBe(401);
    const lookup = await request("/admin/media/lookup", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ sha256: saved.sha256 }),
    });
    expect((await lookup.json()).asset.id).toBe(saved.id);
    expect(
      (
        await request("/admin/media/lookup", {
          method: "POST",
          headers: auth,
          body: JSON.stringify({ sha256: "not-a-hash" }),
        })
      ).status,
    ).toBe(400);
    for (const path of [
      "/admin/media",
      "/admin/media/hash-status",
      `/admin/media/${saved.id}/file`,
    ])
      expect((await request(path)).status).toBe(401);
    expect(
      (
        await request(`/admin/media/${saved.id}`, {
          method: "PATCH",
          body: JSON.stringify({ slug: "unauthorized" }),
        })
      ).status,
    ).toBe(401);
  });
  it("rejects forged MIME, text payloads, SVG, truncated images and oversized files", async () => {
    const malformed = bytes.slice(0, 30);
    const damaged = bytes.slice(0);
    new Uint8Array(damaged)[20] ^= 1;
    for (const [body, type] of [
      [bytes, "image/jpeg"],
      [new TextEncoder().encode("not an image").buffer, "image/png"],
      [new TextEncoder().encode("<svg><script>alert(1)</script></svg>").buffer, "image/svg+xml"],
      [malformed, "image/png"],
      [damaged, "image/png"],
      [new ArrayBuffer(20 * 1024 * 1024 + 1), "image/png"],
    ] as const) {
      expect((await post(body, "fake.png", type)).status).toBe(400);
    }
    expect(await ctx.repos.media.listAll()).toHaveLength(0);
  });
  it("does not trust a client-supplied hash", async () => {
    await asset();
    const form = new FormData();
    form.append("file", new File([await image("blue")], "photo.png", { type: "image/png" }));
    form.append("sha256", await sha256Hex(bytes));
    expect(
      (
        await request("/admin/media", {
          method: "POST",
          headers: { authorization: auth.authorization },
          body: form,
        })
      ).status,
    ).toBe(201);
    expect(await ctx.repos.media.listAll()).toHaveLength(2);
  });
  it("preserves CORS and request headers on authenticated binary responses", async () => {
    const saved = await asset();
    const response = await app.request(
      `/v1/admin/media/${saved.id}/file`,
      {
        headers: { ...auth, origin: "http://localhost:5173" },
      },
      { ...env, ALLOWED_ORIGINS: "http://localhost:5173" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(response.headers.get("api-version")).toBe("1");
    expect(await response.arrayBuffer()).toEqual(bytes);
  });
  it.each(["jpeg", "png", "webp", "avif", "gif"] as const)(
    "accepts real %s content",
    async (format) => {
      const body = await image("green", format);
      expect(inspectImage(body)?.mimeType).toBe(`image/${format}`);
      expect((await post(body, `photo.${format}`, `image/${format}`)).status).toBe(201);
    },
  );
});

describe("upload failures", () => {
  it("never overwrites or cleans up a historical object without metadata", async () => {
    const hash = await sha256Hex(bytes);
    const historicalKey = `originals/${hash.slice(0, 2)}/${hash}.png`;
    const memory = createMemoryStorage();
    await memory.put(historicalKey, bytes, "image/png");
    const broken = {
      ...ctx,
      storage: memory,
      repos: {
        ...ctx.repos,
        media: {
          ...ctx.repos.media,
          completeUpload: async () => {
            throw new Error("db failed");
          },
        },
      },
    };
    await expect(uploadMediaWithResult(broken, input())).rejects.toThrow("db failed");
    expect(memory.keys()).toEqual([historicalKey]);
    expect((await memory.get(historicalKey))?.body).toEqual(bytes);
  });
  it("cleans up a write that succeeded before the storage response failed, then allows retry", async () => {
    const memory = createMemoryStorage();
    const broken = {
      ...ctx,
      storage: {
        ...memory,
        put: async (key: string, body: ArrayBuffer, type: string) => {
          await memory.put(key, body, type);
          throw new Error("network failed");
        },
      },
    };
    await expect(uploadMediaWithResult(broken, input())).rejects.toThrow("network failed");
    expect(memory.keys()).toHaveLength(0);
    expect(await ctx.repos.media.listPendingUploads()).toHaveLength(0);
    expect((await uploadMediaWithResult({ ...ctx, storage: memory }, input())).ok).toBe(true);
  });
  it("removes the object when a database transaction fails", async () => {
    const memory = createMemoryStorage();
    const broken = {
      ...ctx,
      storage: memory,
      repos: {
        ...ctx.repos,
        media: {
          ...ctx.repos.media,
          completeUpload: async () => {
            throw new Error("db failed");
          },
        },
      },
    };
    await expect(uploadMediaWithResult(broken, input())).rejects.toThrow("db failed");
    expect(memory.keys()).toHaveLength(0);
    expect(await ctx.repos.media.listAll()).toHaveLength(0);
    expect(await ctx.repos.media.listPendingUploads()).toHaveLength(0);
  });
  it("keeps a committed object after a lost database response", async () => {
    const complete = ctx.repos.media.completeUpload;
    const broken = {
      ...ctx,
      repos: {
        ...ctx.repos,
        media: {
          ...ctx.repos.media,
          completeUpload: async (candidate: MediaAsset) => {
            await complete(candidate);
            throw new Error("response lost");
          },
        },
      },
    };
    const result = await uploadMediaWithResult(broken, input());
    expect(result.ok).toBe(true);
    if (result.ok) expect(await ctx.storage.exists(result.value.asset.storageKey)).toBe(true);
  });
  it("retains a recoverable reservation when cleanup is unavailable", async () => {
    const memory = createMemoryStorage();
    const broken = {
      ...ctx,
      storage: {
        ...memory,
        delete: async () => {
          throw new Error("R2 unavailable");
        },
      },
      repos: {
        ...ctx.repos,
        media: {
          ...ctx.repos.media,
          completeUpload: async () => {
            throw new Error("db failed");
          },
        },
      },
    };
    await expect(uploadMediaWithResult(broken, input())).rejects.toThrow();
    expect(await ctx.repos.media.listPendingUploads()).toHaveLength(1);
    expect(memory.keys()).toHaveLength(1);
    const recovery = {
      ...ctx,
      storage: memory,
      clock: fixedClock(instantFrom("2026-08-30T01:00:00.000Z")),
    };
    expect(await recoverMediaUploads(recovery, true)).toEqual([
      { mediaId: "id-0001", state: "completed" },
    ]);
    expect(await ctx.repos.media.listPendingUploads()).toHaveLength(0);
    expect(await ctx.repos.media.listAll()).toHaveLength(1);
  });
  it("preserves the journal when commit status cannot be checked", async () => {
    const find = ctx.repos.media.findBySha256;
    let failed = false;
    const memory = createMemoryStorage();
    const broken = {
      ...ctx,
      storage: memory,
      repos: {
        ...ctx.repos,
        media: {
          ...ctx.repos.media,
          completeUpload: async () => {
            failed = true;
            throw new Error("db offline");
          },
          findBySha256: async (hash: string) => {
            if (failed) throw new Error("db offline");
            return find(hash);
          },
        },
      },
    };
    await expect(uploadMediaWithResult(broken, input())).rejects.toThrow();
    expect(memory.keys()).toHaveLength(1);
    expect(await ctx.repos.media.listPendingUploads()).toHaveLength(1);
  });
});

describe("shared image usage and Slugs", () => {
  it("reuses one image in two articles and only detaches the chosen usage", async () => {
    const saved = await asset();
    const articles = [await article("first"), await article("second")];
    for (const a of articles) {
      const response = await request(`/admin/media/article/${a.id}`, {
        method: "PUT",
        headers: auth,
        body: JSON.stringify({
          media: [{ mediaId: saved.id, role: "cover", sortOrder: 0, alt: "photo", caption: null }],
        }),
      });
      expect(response.status).toBe(200);
    }
    expect((await setArticleMedia(ctx, articles[0]!.id, [])).ok).toBe(true);
    expect(await ctx.repos.media.listForArticle(articles[1]!.id)).toHaveLength(1);
    expect(await ctx.storage.exists(saved.storageKey)).toBe(true);
  });
  it("rejects references to missing articles and media", async () => {
    expect(
      (
        await request("/admin/media/article/missing", {
          method: "PUT",
          headers: auth,
          body: JSON.stringify({ media: [] }),
        })
      ).status,
    ).toBe(404);
    const a = await article("one");
    expect(
      (
        await request(`/admin/media/article/${a.id}`, {
          method: "PUT",
          headers: auth,
          body: JSON.stringify({
            media: [
              { mediaId: "missing", role: "cover", sortOrder: 0, alt: "photo", caption: null },
            ],
          }),
        })
      ).status,
    ).toBe(404);
  });
  it("retains original URLs and all public Slug aliases after renaming", async () => {
    const saved = await asset();
    for (const slug of ["tokyo-trip", "tokyo-city"]) {
      const response = await request(`/admin/media/${saved.id}`, {
        method: "PATCH",
        headers: auth,
        body: JSON.stringify({ slug }),
      });
      expect(response.status).toBe(200);
      expect((await response.json()).url).toContain(saved.storageKey);
    }
    for (const slug of ["tokyo-trip", "tokyo-city"]) {
      const response = await request(`/images/${slug}.png`);
      expect(response.status).toBe(200);
      expect(await response.arrayBuffer()).toEqual(bytes);
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    }
    expect((await request("/images/tokyo-trip.jpg")).status).toBe(404);
    expect((await request("/images/unknown.png")).status).toBe(404);
    const files = new Map(
      buildExportFiles(await loadContentSnapshot(ctx)).map((file) => [file.path, file.contents]),
    );
    expect(parseExportFiles((path) => files.get(path) ?? null).mediaSlugAliases).toHaveLength(2);
    expect(parseExportFiles((path) => files.get(path) ?? null).mediaHashes).toHaveLength(1);
  });
  it("prevents alias reuse, including simultaneous Slug updates", async () => {
    const one = await asset();
    const other = await uploadMediaWithResult(ctx, input(await image("blue")));
    if (!other.ok) throw new Error("fixture");
    const results = await Promise.all([
      updateMediaSlug(ctx, one.id, "shared-name"),
      updateMediaSlug(ctx, other.value.asset.id, "shared-name"),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const owner = (await ctx.repos.media.findBySlug("shared-name"))!;
    await updateMediaSlug(ctx, owner.id, "new-name");
    const loser = owner.id === one.id ? other.value.asset.id : one.id;
    expect((await updateMediaSlug(ctx, loser, "shared-name")).ok).toBe(false);
  });
  it("cleans up a Slug collision between concurrent different uploads", async () => {
    const memory = createMemoryStorage();
    const context = { ...ctx, storage: memory };
    const results = await Promise.all([
      uploadMediaWithResult(context, input(bytes, "a.png", "same-slug")),
      uploadMediaWithResult(context, input(await image("blue"), "b.png", "same-slug")),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(memory.keys()).toHaveLength(1);
    expect(await ctx.repos.media.listPendingUploads()).toHaveLength(0);
  });
});

describe("legacy hash migration", () => {
  it("keeps duplicate legacy records and references, picks a stable canonical image and skips missing originals", async () => {
    const a = await article("legacy");
    for (const [id, key, hash] of [
      ["legacy-1", "images/one.png", "old-one"],
      ["legacy-2", "images/two.png", "old-two"],
      ["missing", "images/missing.png", "old-missing"],
    ]) {
      await ctx.repos.media.save({
        id: id as MediaId,
        storageKey: key!,
        sha256: hash!,
        mimeType: "image/png",
        width: 4,
        height: 3,
        size: bytes.byteLength,
        createdAt: "2020-01-01T00:00:00.000Z",
      });
      if (id !== "missing") await ctx.storage.put(key!, bytes, "image/png");
    }
    await setArticleMedia(ctx, a.id, [
      {
        articleId: a.id,
        mediaId: "legacy-2" as MediaId,
        role: "cover",
        alt: "legacy photo",
        caption: null,
        sortOrder: 0,
      },
    ]);
    const before = await ctx.repos.media.listForArticle(a.id);
    const get = ctx.storage.get.bind(ctx.storage);
    const readOrder: string[] = [];
    const reads = vi.spyOn(ctx.storage, "get").mockImplementation(async (key) => {
      if (key === "images/one.png") await new Promise((resolve) => setTimeout(resolve, 20));
      readOrder.push(key);
      return get(key);
    });
    const progress = vi.fn();
    const dry = await backfillMediaHashes(ctx, { apply: false, onProgress: progress });
    expect(readOrder[0]).not.toBe("images/one.png");
    expect(progress).toHaveBeenLastCalledWith(3, 3);
    expect(dry.map((item) => item.state)).toEqual(["verified", "duplicate", "skipped"]);
    expect((await ctx.repos.media.hashStatus()).verified).toBe(0);
    const report = await backfillMediaHashes(ctx, { apply: true });
    reads.mockRestore();
    expect(report[1]).toMatchObject({ state: "duplicate", canonicalId: "legacy-1" });
    const duplicate = await uploadMediaWithResult(ctx, input());
    expect(duplicate.ok && duplicate.value.asset.id).toBe("legacy-1");
    expect(await ctx.repos.media.listAll()).toHaveLength(3);
    expect(await ctx.repos.media.listForArticle(a.id)).toEqual(before);
    expect((await ctx.repos.media.findById("legacy-2" as MediaId))?.sha256).toBe("old-two");
    expect(await ctx.storage.exists("images/two.png")).toBe(true);
    expect((await backfillMediaHashes(ctx, { apply: true })).map((item) => item.state)).toEqual([
      "skipped",
    ]);
    expect(await ctx.repos.media.hashStatus()).toMatchObject({ verified: 2, pending: 1 });
  });
});
