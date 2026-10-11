import {
  err,
  ok,
  parseSlug,
  type ArticleId,
  type ArticleMedia,
  type MediaAsset,
  type MediaId,
  type Result,
} from "@tomokichi/domain";
import type { AppContext } from "../../context.js";
import { extensionFor, inspectImage, MAX_UPLOAD_BYTES, sha256Hex } from "./image-content.js";
export { extensionFor, inspectImage, MAX_UPLOAD_BYTES, sha256Hex } from "./image-content.js";

export interface UploadMediaInput {
  readonly body: ArrayBuffer;
  readonly mimeType: string;
  readonly originalName: string;
  readonly width?: number;
  readonly height?: number;
  readonly slug?: string;
}
export interface UploadMediaResult {
  readonly asset: MediaAsset;
  readonly duplicate: boolean;
}

export async function uploadMediaWithResult(
  ctx: AppContext,
  input: UploadMediaInput,
): Promise<Result<UploadMediaResult>> {
  if (input.body.byteLength === 0 || input.body.byteLength > MAX_UPLOAD_BYTES)
    return err({
      code: "API_VALIDATION_FAILED",
      message: "画像は20MB以下のファイルを指定してください",
      field: "file",
    });
  const content = inspectImage(input.body);
  if (!content || (input.mimeType !== "" && input.mimeType !== content.mimeType))
    return err({
      code: "API_VALIDATION_FAILED",
      message: "画像の内容・形式を確認してください（JPEG / PNG / WebP / AVIF / GIF）",
      field: "file",
    });
  const sha256 = await sha256Hex(input.body);
  const existing = await ctx.repos.media.findBySha256(sha256);
  if (existing) return ok({ asset: existing, duplicate: true });
  const slug = input.slug?.trim() ? parseSlug(input.slug) : ok(null);
  if (!slug.ok) return slug;
  if (slug.value && (await ctx.repos.media.findBySlug(slug.value)))
    return err({ code: "API_CONFLICT", message: "この画像Slugは使用されています", field: "slug" });
  const mediaId = ctx.ids.next<MediaId>();
  const asset: MediaAsset = {
    id: mediaId,
    // Each reservation owns its key, including cleanup. Historical untracked
    // keys may still be used by Markdown, so never overwrite or delete them.
    storageKey: `originals/${sha256.slice(0, 2)}/${sha256}-${mediaId}.${extensionFor(content.mimeType)}`,
    mimeType: content.mimeType,
    width: content.width,
    height: content.height,
    size: input.body.byteLength,
    sha256,
    contentSha256: sha256,
    originalName:
      [...(input.originalName.split(/[\\/]/).at(-1) ?? "")]
        .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
        .join("")
        .slice(0, 255) || null,
    slug: slug.value,
    createdAt: ctx.clock.now(),
  };
  if (!(await ctx.repos.media.reserveUpload(asset))) {
    // The owner is responsible for writing and cleanup. Never steal its reservation.
    for (let attempt = 0; attempt < 20; attempt++) {
      const ready = await ctx.repos.media.findBySha256(sha256);
      if (ready) return ok({ asset: ready, duplicate: true });
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return err({
      code: "API_CONFLICT",
      message: "同じ画像を保存中です。少し待って再試行してください",
      field: "file",
    });
  }
  try {
    const ready = await ctx.repos.media.findBySha256(sha256);
    if (ready) {
      await ctx.repos.media.releaseUpload(sha256, asset.id);
      return ok({ asset: ready, duplicate: true });
    }
    await ctx.storage.put(asset.storageKey, input.body, asset.mimeType);
    await ctx.repos.media.completeUpload(asset);
    ctx.logger.info("media.uploaded", { mediaId: asset.id, size: asset.size });
    return ok({ asset, duplicate: false });
  } catch (error) {
    // D1 may have committed before the network failed. If verification also
    // fails, preserve the reservation and object for explicit recovery.
    const committed = await ctx.repos.media.findBySha256(sha256);
    if (committed) {
      await ctx.repos.media.releaseUpload(sha256, asset.id);
      return ok({ asset: committed, duplicate: committed.id !== asset.id });
    }
    try {
      await ctx.storage.delete(asset.storageKey);
      await ctx.repos.media.releaseUpload(sha256, asset.id);
    } catch {
      ctx.logger.error("media.cleanup_pending", {
        mediaId: asset.id,
        storageKey: asset.storageKey,
      });
    }
    if (asset.slug && (await ctx.repos.media.findBySlug(asset.slug)))
      return err({
        code: "API_CONFLICT",
        message: "この画像Slugは使用されています",
        field: "slug",
      });
    throw error;
  }
}

/** Compatibility for existing application callers. */
export async function uploadMedia(
  ctx: AppContext,
  input: UploadMediaInput,
): Promise<Result<MediaAsset>> {
  const result = await uploadMediaWithResult(ctx, input);
  return result.ok ? ok(result.value.asset) : result;
}

export async function updateMediaSlug(
  ctx: AppContext,
  id: MediaId,
  value: string | null,
): Promise<Result<MediaAsset>> {
  const asset = await ctx.repos.media.findById(id);
  if (!asset) return err({ code: "MEDIA_NOT_FOUND", message: "画像が見つかりません" });
  const slug = value?.trim() ? parseSlug(value) : ok(null);
  if (!slug.ok) return slug;
  if (slug.value && extensionFor(asset.mimeType) === "bin")
    return err({
      code: "API_VALIDATION_FAILED",
      message: "公開SlugはJPEG / PNG / WebP / AVIF / GIFで設定できます",
      field: "slug",
    });
  const reserved = slug.value ? await ctx.repos.media.findBySlug(slug.value) : null;
  if (reserved && reserved.id !== id)
    return err({ code: "API_CONFLICT", message: "この画像Slugは使用されています", field: "slug" });
  try {
    await ctx.repos.media.updateSlug(id, slug.value);
  } catch (error) {
    if (slug.value && (await ctx.repos.media.findBySlug(slug.value)))
      return err({
        code: "API_CONFLICT",
        message: "この画像Slugは使用されています",
        field: "slug",
      });
    throw error;
  }
  return ok({ ...asset, slug: slug.value });
}

/** Removing a usage never deletes original, thumbnail, OGP or Markdown URLs. */
export async function setArticleMedia(
  ctx: AppContext,
  articleId: ArticleId,
  media: readonly ArticleMedia[],
): Promise<Result<readonly ArticleMedia[]>> {
  if (!(await ctx.repos.articles.findById(articleId)))
    return err({ code: "ARTICLE_NOT_FOUND", message: "記事が見つかりません" });
  const missingAlt = media.filter((m) => m.alt.trim() === "");
  if (missingAlt.length > 0)
    return err({
      code: "SEO_IMAGE_ALT_MISSING",
      message: `${missingAlt.length} image(s) without alt text`,
      field: "alt",
    });
  for (const usage of media)
    if (usage.articleId !== articleId || !(await ctx.repos.media.findById(usage.mediaId)))
      return err({ code: "MEDIA_NOT_FOUND", message: "画像が見つかりません", field: "mediaId" });
  await ctx.repos.media.replaceForArticle(articleId, media);
  return ok(media);
}
