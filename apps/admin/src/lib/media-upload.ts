import type { MediaAssetDto } from "@tomokichi/contracts";
import { api } from "./api";

export const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/avif,image/gif";
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export async function uploadImage(
  file: File,
  slug = "",
): Promise<{ asset: MediaAssetDto; duplicate: boolean }> {
  if (file.size === 0 || file.size > MAX_UPLOAD_BYTES)
    throw new Error("画像は20MB以下のファイルを指定してください");
  if (file.type && !IMAGE_ACCEPT.split(",").includes(file.type))
    throw new Error("JPEG / PNG / WebP / AVIF / GIFを指定してください");
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    const found = await api.lookupMedia(hash);
    if (found.asset) return { asset: found.asset, duplicate: true };
  }
  const uploaded = await api.uploadMedia(file, undefined, slug);
  return { asset: uploaded, duplicate: uploaded.duplicate };
}

export function matchesMedia(asset: MediaAssetDto, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return [asset.slug, asset.originalName, asset.url].some((value) =>
    value?.toLowerCase().includes(needle),
  );
}
