import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { validate } from "@tomokichi/contracts";
import {
  setArticleMedia,
  setMediaAiGenerated,
  uploadMediaWithResult,
  updateMediaSlug,
  MAX_UPLOAD_BYTES,
} from "@tomokichi/application";
import type { ArticleId, MediaAsset, MediaId } from "@tomokichi/domain";
import type { MediaPageDto } from "@tomokichi/contracts";
import type { AppEnv } from "../app.js";
import { domainErrorResponse, errorResponse } from "../http.js";
import { toMediaAssetDto } from "../mappers.js";
import { mediaUsageSchema } from "../schemas.js";

/**
 * Every word must appear in the slug, the uploaded file name, or the storage
 * key. The full public URL is left out on purpose: every asset shares its host
 * and extension, so a query like "jpg" used to match the whole library.
 */
export function matchesMediaQuery(asset: MediaAsset, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [asset.slug, asset.originalName, asset.storageKey]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

export function mediaRoutes() {
  const routes = new Hono<AppEnv>();
  routes.use(
    "/",
    bodyLimit({
      maxSize: MAX_UPLOAD_BYTES + 64 * 1024,
      onError: (c) =>
        errorResponse(
          c,
          "API_VALIDATION_FAILED",
          "画像は20MB以下のファイルを指定してください",
          400,
        ),
    }),
  );

  // `?limit=` pages and searches on the server, so the library never ships
  // every asset to the browser. Without it the full list is returned, as
  // older admin bundles expect.
  routes.get("/", async (c) => {
    const ctx = c.get("ctx");
    const dto = (asset: MediaAsset) =>
      toMediaAssetDto(
        asset,
        ctx.mediaUrls.resolve(asset.storageKey),
        c.env.PUBLIC_IMAGE_URL,
        (key) => ctx.mediaUrls.resolve(key),
      );
    const assets = (await ctx.repos.media.listAll()).toSorted((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
    const limitParam = c.req.query("limit");
    if (limitParam === undefined) return c.json({ items: assets.map(dto) });

    const limit = Math.min(Math.max(Number.parseInt(limitParam, 10) || 60, 1), 200);
    const offset = Math.max(Number.parseInt(c.req.query("offset") ?? "0", 10) || 0, 0);
    const matching = assets.filter((asset) => matchesMediaQuery(asset, c.req.query("q") ?? ""));
    const page = matching.slice(offset, offset + limit);
    const next = offset + page.length;
    const body: MediaPageDto = {
      items: page.map(dto),
      total: matching.length,
      nextOffset: next < matching.length ? next : null,
    };
    return c.json(body);
  });

  routes.get("/hash-status", async (c) => c.json(await c.get("ctx").repos.media.hashStatus()));
  routes.post("/lookup", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const hash = body && typeof body === "object" && "sha256" in body ? body.sha256 : null;
    if (typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash))
      return errorResponse(c, "API_VALIDATION_FAILED", "invalid SHA-256", 400);
    const ctx = c.get("ctx");
    const asset = await ctx.repos.media.findBySha256(hash);
    return c.json({
      asset: asset
        ? toMediaAssetDto(
            asset,
            ctx.mediaUrls.resolve(asset.storageKey),
            c.env.PUBLIC_IMAGE_URL,
            (key) => ctx.mediaUrls.resolve(key),
          )
        : null,
    });
  });
  routes.patch("/:id", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const hasSlug = !!body && typeof body === "object" && "slug" in body;
    const hasAiFlag = !!body && typeof body === "object" && "aiGenerated" in body;
    if (
      !body ||
      typeof body !== "object" ||
      (!hasSlug && !hasAiFlag) ||
      (hasSlug && body.slug !== null && typeof body.slug !== "string") ||
      (hasAiFlag && typeof body.aiGenerated !== "boolean")
    )
      return errorResponse(c, "API_VALIDATION_FAILED", "invalid media update", 400);
    const ctx = c.get("ctx");
    const id = c.req.param("id") as MediaId;
    let result = hasSlug
      ? await updateMediaSlug(ctx, id, body.slug as string | null)
      : await setMediaAiGenerated(ctx, id, body.aiGenerated as boolean);
    if (result.ok && hasSlug && hasAiFlag)
      result = await setMediaAiGenerated(ctx, id, body.aiGenerated as boolean);
    return result.ok
      ? c.json(
          toMediaAssetDto(
            result.value,
            ctx.mediaUrls.resolve(result.value.storageKey),
            c.env.PUBLIC_IMAGE_URL,
            (key) => ctx.mediaUrls.resolve(key),
          ),
        )
      : domainErrorResponse(c, result.errors);
  });
  routes.get("/:id/file", async (c) => {
    const ctx = c.get("ctx");
    const asset = await ctx.repos.media.findById(c.req.param("id") as MediaId);
    const object = asset ? await ctx.storage.get(asset.storageKey) : null;
    if (!asset || !object) return errorResponse(c, "MEDIA_NOT_FOUND", "image not found", 404);
    return c.body(object.body, 200, {
      "content-type": asset.mimeType,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
  });

  routes.post("/", async (c) => {
    if (c.env.MEDIA_UPLOADS_PAUSED === "1") {
      c.header("Retry-After", "60");
      return errorResponse(
        c,
        "API_CONFLICT",
        "画像のメンテナンス中です。しばらくしてから再試行してください",
        503,
      );
    }
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
    const slug = form.get("slug");
    if (slug !== null && typeof slug !== "string")
      return errorResponse(c, "API_VALIDATION_FAILED", "invalid slug", 400);
    const result = await uploadMediaWithResult(ctx, {
      body: await file.arrayBuffer(),
      mimeType: file.type,
      originalName: file.name,
      ...(slug ? { slug } : {}),
    });
    if (!result.ok) return domainErrorResponse(c, result.errors);
    return c.json(
      {
        ...toMediaAssetDto(
          result.value.asset,
          ctx.mediaUrls.resolve(result.value.asset.storageKey),
          c.env.PUBLIC_IMAGE_URL,
          (key) => ctx.mediaUrls.resolve(key),
        ),
        duplicate: result.value.duplicate,
      },
      result.value.duplicate ? 200 : 201,
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
