import { beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { createTestContext } from "@tomokichi/infra-d1/testing-context";
import { uploadMediaWithResult, type AppContext } from "@tomokichi/application";
import type { MediaAssetDto, MediaPageDto } from "@tomokichi/contracts";
import type { MediaAsset } from "@tomokichi/domain";
import { createApp } from "../app.js";
import type { Env } from "../env.js";
import { thumbnailKey } from "../mappers.js";
import { matchesMediaQuery } from "../routes/media.js";

const auth = { authorization: "Bearer test" };
const env = { ADMIN_TOKEN: "test" } as Env;
let ctx: AppContext;
let app: ReturnType<typeof createApp>;

async function upload(name: string, slug: string, color: string) {
  const body = Uint8Array.from(
    await sharp({ create: { width: 4, height: 3, channels: 4, background: color } })
      .png()
      .toBuffer(),
  ).buffer;
  const result = await uploadMediaWithResult(ctx, {
    body,
    originalName: name,
    mimeType: "image/png",
    slug,
  });
  if (!result.ok) throw new Error("fixture failed");
}

beforeEach(async () => {
  ctx = await createTestContext();
  app = createApp({ contextFactory: () => ctx });
  await upload("kyoto-temple.png", "kyoto-temple", "red");
  await upload("kyoto-night.png", "kyoto-night", "blue");
  await upload("paris.png", "paris-street", "green");
});

const search = async (query: string) =>
  (await (
    await app.request(`/v1/admin/media?${query}`, { headers: auth }, env)
  ).json()) as MediaPageDto;

describe("media library search", () => {
  it("pages on the server and reports the total", async () => {
    const first = await search("limit=2");
    expect(first.items).toHaveLength(2);
    expect(first.total).toBe(3);
    expect(first.nextOffset).toBe(2);
    const rest = await search("limit=2&offset=2");
    expect(rest.items).toHaveLength(1);
    expect(rest.nextOffset).toBeNull();
  });

  it("matches every word against slug and file name, not the shared URL", async () => {
    expect((await search("limit=60&q=kyoto")).total).toBe(2);
    expect((await search("limit=60&q=kyoto%20night")).items.map((item) => item.slug)).toEqual([
      "kyoto-night",
    ]);
    // Every asset's URL has the media host and an extension; neither matches all.
    expect((await search("limit=60&q=media")).total).toBe(0);
  });

  it("keeps the full list for older admin bundles that send no limit", async () => {
    const body = (await (await app.request("/v1/admin/media", { headers: auth }, env)).json()) as {
      items: MediaAssetDto[];
      total?: number;
    };
    expect(body.items).toHaveLength(3);
    expect(body.total).toBeUndefined();
  });

  it("offers the 340px build derivative as a thumbnail", async () => {
    const [item] = (await search("limit=1")).items;
    expect(item?.thumbnailUrl).toMatch(/\/_img\/[a-f0-9]{16}-4\.webp$/);
  });
});

const asset = (width: number | null, mimeType = "image/jpeg") =>
  ({ sha256: "a".repeat(64), width, mimeType }) as MediaAsset;

describe("thumbnailKey", () => {
  it("uses the smallest width the build produces", () => {
    expect(thumbnailKey(asset(4000))).toBe(`_img/${"a".repeat(16)}-340.webp`);
    expect(thumbnailKey(asset(200))).toBe(`_img/${"a".repeat(16)}-200.webp`);
    expect(thumbnailKey(asset(null))).toBe(`_img/${"a".repeat(16)}-340.webp`);
    expect(thumbnailKey(asset(800, "image/svg+xml"))).toBeNull();
  });
  it("matchesMediaQuery ignores empty queries", () => {
    expect(matchesMediaQuery(asset(1), "  ")).toBe(true);
  });
});
