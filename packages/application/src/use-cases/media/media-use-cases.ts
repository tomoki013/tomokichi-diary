import {
  err,
  ok,
  type ArticleId,
  type ArticleMedia,
  type MediaAsset,
  type MediaId,
  type Result,
} from "@tomokichi/domain";
import type { AppContext } from "../../context.js";

export interface UploadMediaInput {
  readonly body: ArrayBuffer;
  readonly mimeType: string;
  readonly originalName: string;
  readonly width?: number;
  readonly height?: number;
}

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"]);

async function sha256Hex(body: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", body);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function extensionFor(mimeType: string): string {
  return (
    {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/avif": "avif",
      "image/gif": "gif",
    }[mimeType] ?? "bin"
  );
}

/**
 * Content-addressed upload: the same bytes always map to the same key, so a
 * re-upload is free and the store never accumulates duplicates. Derived formats
 * (AVIF, thumbnails) are not stored here — they are rebuildable (instruction §26).
 */
export async function uploadMedia(
  ctx: AppContext,
  input: UploadMediaInput,
): Promise<Result<MediaAsset>> {
  if (!ALLOWED_MIME.has(input.mimeType)) {
    return err({
      code: "API_VALIDATION_FAILED",
      message: `unsupported media type: ${input.mimeType}`,
      field: "mimeType",
    });
  }

  const sha256 = await sha256Hex(input.body);
  const existing = await ctx.repos.media.findBySha256(sha256);
  if (existing) return ok(existing);

  const storageKey = `originals/${sha256.slice(0, 2)}/${sha256}.${extensionFor(input.mimeType)}`;
  await ctx.storage.put(storageKey, input.body, input.mimeType);

  const asset: MediaAsset = {
    id: ctx.ids.next<MediaId>(),
    storageKey,
    mimeType: input.mimeType,
    width: input.width ?? null,
    height: input.height ?? null,
    size: input.body.byteLength,
    sha256,
    createdAt: ctx.clock.now(),
  };
  await ctx.repos.media.save(asset);
  ctx.logger.info("media.uploaded", { mediaId: asset.id, size: asset.size });
  return ok(asset);
}

/** Alt text lives on the usage, so the same asset can describe different things. */
export async function setArticleMedia(
  ctx: AppContext,
  articleId: ArticleId,
  media: readonly ArticleMedia[],
): Promise<Result<readonly ArticleMedia[]>> {
  const missingAlt = media.filter((m) => m.alt.trim() === "");
  if (missingAlt.length > 0) {
    return err({
      code: "SEO_IMAGE_ALT_MISSING",
      message: `${missingAlt.length} image(s) without alt text`,
      field: "alt",
    });
  }
  await ctx.repos.media.replaceForArticle(articleId, media);
  return ok(media);
}
