import { Hono } from "hono";
import { validate } from "@tomokichi/contracts";
import { setArticleMedia, uploadMedia } from "@tomokichi/application";
import type { ArticleId, MediaId } from "@tomokichi/domain";
import type { AppEnv } from "../app.js";
import { domainErrorResponse, errorResponse } from "../http.js";
import { toMediaAssetDto } from "../mappers.js";
import { mediaUsageSchema } from "../schemas.js";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export function mediaRoutes() {
  const routes = new Hono<AppEnv>();

  routes.get("/", async (c) => {
    const ctx = c.get("ctx");
    const assets = await ctx.repos.media.listAll();
    return c.json({
      items: assets.map((asset) => toMediaAssetDto(asset, ctx.mediaUrls.resolve(asset.storageKey))),
    });
  });

  routes.post("/", async (c) => {
    const form = await c.req.formData().catch(() => null);
    if (form === null) {
      return errorResponse(c, "API_VALIDATION_FAILED", "expected a multipart form body", 400);
    }
    // `FormData.get` is typed as `string | File`, so the narrowing needs `unknown`.
    const file: unknown = form.get("file");
    if (!(file instanceof File)) {
      return errorResponse(c, "API_VALIDATION_FAILED", "a `file` field is required", 400);
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return errorResponse(
        c,
        "API_VALIDATION_FAILED",
        `file exceeds ${MAX_UPLOAD_BYTES} bytes`,
        400,
      );
    }

    const ctx = c.get("ctx");
    const result = await uploadMedia(ctx, {
      body: await file.arrayBuffer(),
      mimeType: file.type,
      originalName: file.name,
      // Dimensions come from the client: decoding an image inside a Worker is
      // expensive, and a wrong value is worse than none.
      ...(form.get("width") ? { width: Number(form.get("width")) } : {}),
      ...(form.get("height") ? { height: Number(form.get("height")) } : {}),
    });
    if (!result.ok) return domainErrorResponse(c, result.errors);
    return c.json(
      toMediaAssetDto(result.value, ctx.mediaUrls.resolve(result.value.storageKey)),
      201,
    );
  });

  routes.put("/article/:id", async (c) => {
    const parsed = validate(mediaUsageSchema, await c.req.json().catch(() => null));
    if (!parsed.ok)
      return errorResponse(c, parsed.code, "invalid request body", 400, parsed.issues);

    const articleId = c.req.param("id") as ArticleId;
    const result = await setArticleMedia(
      c.get("ctx"),
      articleId,
      parsed.value.media.map((usage) => ({
        articleId,
        mediaId: usage.mediaId as MediaId,
        role: usage.role,
        sortOrder: usage.sortOrder,
        alt: usage.alt,
        caption: usage.caption,
      })),
    );
    return result.ok ? c.json({ ok: true }) : domainErrorResponse(c, result.errors);
  });

  return routes;
}
