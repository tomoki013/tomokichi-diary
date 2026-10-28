import { beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { createTestContext } from "@tomokichi/infra-d1/testing-context";
import { hasAiProvenance, type AppContext } from "@tomokichi/application";
import { createApp } from "../app.js";
import type { Env } from "../env.js";

/*
 * Why this exists: the gallery leaves out AI-generated images and takes likes
 * on each photograph. Both rest on the `ai_generated` flag, which is set by
 * hand in the admin or read from the file's provenance on upload.
 */

const env = { ADMIN_TOKEN: "test", PUBLIC_IMAGE_URL: "https://api.example/v1/images" } as Env;
const auth = { authorization: "Bearer test", "content-type": "application/json" };
const json = { "content-type": "application/json" };
const visitor = "visitor-0123456789abcdefghij";

let ctx: AppContext;
let app: ReturnType<typeof createApp>;
const request = (path: string, init: RequestInit = {}) => app.request(`/v1${path}`, init, env);

const generatedXmp = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"/></rdf:RDF></x:xmpmeta>`;

async function image(color: string, xmp?: string): Promise<ArrayBuffer> {
  const pipeline = sharp({ create: { width: 4, height: 3, channels: 3, background: color } });
  return Uint8Array.from(await (xmp ? pipeline.withXmp(xmp) : pipeline).jpeg().toBuffer()).buffer;
}

let uploads = 0;
async function upload(body: ArrayBuffer): Promise<{ id: string; aiGenerated: boolean }> {
  const form = new FormData();
  form.append("file", new File([body], "photo.jpg", { type: "image/jpeg" }));
  form.append("slug", `photo-${++uploads}`);
  const response = await request("/admin/media", {
    method: "POST",
    headers: { authorization: auth.authorization },
    body: form,
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string; aiGenerated: boolean };
}

const like = (id: string) =>
  request(`/photo-likes/${id}`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ visitorId: visitor }),
  });

beforeEach(async () => {
  ctx = await createTestContext();
  app = createApp({ contextFactory: () => ctx });
});

describe("AI-generated flag", () => {
  it("is set on upload when the file says a model made it, and not otherwise", async () => {
    expect((await upload(await image("red"))).aiGenerated).toBe(false);
    expect((await upload(await image("blue", generatedXmp))).aiGenerated).toBe(true);
  });

  it("does not treat a bare C2PA manifest as generated", () => {
    const camera = new TextEncoder().encode("jumb c2pa.claim claim_generator Pixel Camera").buffer;
    expect(hasAiProvenance(camera)).toBe(false);
  });

  it("can be switched by hand and is kept with the asset", async () => {
    const { id } = await upload(await image("red"));
    const response = await request(`/admin/media/${id}`, {
      method: "PATCH",
      headers: auth,
      body: JSON.stringify({ aiGenerated: true }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id, aiGenerated: true });
    expect((await ctx.repos.media.findById(id as never))?.aiGenerated).toBe(true);
  });

  it("rejects an update that is neither a slug nor a boolean flag", async () => {
    const { id } = await upload(await image("red"));
    for (const body of [{}, { aiGenerated: "yes" }]) {
      const response = await request(`/admin/media/${id}`, {
        method: "PATCH",
        headers: auth,
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }
  });
});

describe("/v1/photo-likes/:mediaId", () => {
  it("toggles: a second tap removes the like rather than doubling it", async () => {
    const { id } = await upload(await image("red"));
    expect(await (await like(id)).json()).toEqual({ count: 1, liked: true });
    expect(await (await like(id)).json()).toEqual({ count: 0, liked: false });
  });

  it("reports the visitor's own state and the counts for every photograph", async () => {
    const { id } = await upload(await image("red"));
    await like(id);
    const state = await request(`/photo-likes/${id}?visitorId=${visitor}`);
    expect(await state.json()).toEqual({ count: 1, liked: true });
    const counts = await request("/photo-likes");
    expect(await counts.json()).toEqual({ counts: { [id]: 1 } });
  });

  it("takes no likes on an unknown or AI-generated image", async () => {
    expect((await like("missing")).status).toBe(404);
    const { id } = await upload(await image("blue", generatedXmp));
    expect((await like(id)).status).toBe(404);
  });

  it("rejects a malformed visitor id", async () => {
    const { id } = await upload(await image("red"));
    const response = await request(`/photo-likes/${id}`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ visitorId: "short" }),
    });
    expect(response.status).toBe(400);
  });
});
