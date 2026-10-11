import { Hono } from "hono";
import type { AppEnv } from "../app.js";
import { errorResponse } from "../http.js";

const EXTENSIONS: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
};

/** Public aliases for already-public raster originals; no hash lookup or listing. */
export function imageRoutes() {
  const routes = new Hono<AppEnv>();
  routes.get("/:filename", async (c) => {
    const match = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.(jpg|png|webp|avif|gif)$/.exec(
      c.req.param("filename"),
    );
    const ctx = c.get("ctx");
    const asset = match ? await ctx.repos.media.findBySlug(match[1]!) : null;
    if (!match || !asset || EXTENSIONS[match[2]!] !== asset.mimeType)
      return errorResponse(c, "API_NOT_FOUND", "image not found", 404);
    const object = await ctx.storage.get(asset.storageKey);
    if (!object) return errorResponse(c, "API_NOT_FOUND", "image not found", 404);
    return c.body(object.body, 200, {
      "content-type": asset.mimeType,
      "content-length": String(object.size),
      "cache-control": "public, max-age=3600",
      "x-content-type-options": "nosniff",
      "access-control-allow-origin": "*",
    });
  });
  return routes;
}
