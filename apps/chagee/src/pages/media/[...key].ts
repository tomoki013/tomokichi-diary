import type { APIRoute } from "astro";
import { guideEnv } from "../../lib/env";

/**
 * Photos from this site's own R2 bucket. Keys are content-stable (re-uploading
 * a photo gives it a new key), so responses can be cached for a year.
 */
const TYPES: Record<string, string> = {
  webp: "image/webp",
  avif: "image/avif",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

export const GET: APIRoute = async ({ params }) => {
  const key = params.key ?? "";
  const extension = key.split(".").pop()?.toLowerCase() ?? "";
  if (
    !/^[a-z0-9][a-z0-9/_-]*\.[a-z0-9]+$/.test(key) ||
    key.includes("..") ||
    !(extension in TYPES)
  ) {
    return new Response("Not Found", { status: 404 });
  }
  const object = await guideEnv().MEDIA.get(key);
  if (object === null) return new Response("Not Found", { status: 404 });
  return new Response(object.body, {
    headers: {
      "Content-Type": TYPES[extension] ?? "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: object.httpEtag,
    },
  });
};
