import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { createTestContext } from "@tomokichi/infra-d1/testing-context";
import {
  inspectImage,
  sha256Hex,
  uploadMediaWithResult,
  type AppContext,
} from "@tomokichi/application";
import type { MediaAsset } from "@tomokichi/domain";
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
