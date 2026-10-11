import { createServer } from "node:http";
import sharp from "sharp";
import { createTestContext } from "../infrastructure/database/d1/src/__tests__/context.js";
import { createApp } from "../apps/api/dist/app.js";
import { createArticle, uploadMediaWithResult } from "@tomokichi/application";
import type { AuthorId } from "@tomokichi/domain";
import type { Env } from "../apps/api/dist/env.js";
// An isolated fixture for browser regression tests. Nothing is written to D1 or R2.
const ctx = await createTestContext();
const apiOrigin = "http://127.0.0.1:8787";
const context = {
  ...ctx,
  mediaUrls: { resolve: (key: string) => `${apiOrigin}/preview-assets/${key}` },
  logger: {
    ...ctx.logger,
    error: (event: string, fields?: unknown) => console.error(event, fields),
  },
};
const app = createApp({
  contextFactory: () => context,
  publishSite: async () => ({ state: "preview" }),
});
const env = {
  ADMIN_TOKEN: "media-preview",
  ALLOWED_ORIGINS: "http://127.0.0.1:5173",
  PUBLIC_IMAGE_URL: `${apiOrigin}/v1/images`,
  DB: { prepare: () => ({ first: async () => null }) },
} as unknown as Env;
app.get("/preview-assets/*", async (c) => {
  const object = await ctx.storage.get(c.req.path.slice("/preview-assets/".length));
  return object
    ? new Response(object.body, {
        headers: { "content-type": object.mimeType, "access-control-allow-origin": "*" },
      })
    : new Response(null, { status: 404 });
});
const photo = Uint8Array.from(
  await sharp({ create: { width: 640, height: 480, channels: 4, background: "#28767d" } })
    .png()
    .toBuffer(),
).buffer;
await uploadMediaWithResult(ctx, {
  body: photo,
  originalName: "trip-photo.png",
  mimeType: "image/png",
  slug: "trip-photo",
});
await createArticle(ctx, {
  slug: "media-test",
  locale: "ja",
  path: "/posts/media-test",
  authorId: "author-tomokichi" as AuthorId,
  draft: {
    title: "画像再利用テスト",
    summary: "画像のテスト",
    bodyMarkdown: "画像を追加して確認できます。",
  },
});
createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers))
      if (value) headers.set(key, Array.isArray(value) ? value.join(",") : value);
    const body = Buffer.concat(chunks);
    const response = await app.request(
      `${apiOrigin}${req.url}`,
      {
        method: req.method,
        headers,
        ...(body.length ? { body: Uint8Array.from(body).buffer } : {}),
      },
      env,
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(500);
    res.end("Preview API error");
  }
}).listen(8787, "127.0.0.1", () =>
  console.log("Memory-only preview API: http://127.0.0.1:8787; token: media-preview"),
);
