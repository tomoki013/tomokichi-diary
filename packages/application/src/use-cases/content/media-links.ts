import type { MediaAsset } from "@tomokichi/domain";

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
};

// `https://<api host>/v1/images/<slug>.<ext>`, the public alias the admin
// hands out for a photo. The host is not checked: what matters is the slug.
const SLUG_URL =
  /https?:\/\/[^\s/()"'<>]+\/v1\/images\/([a-z0-9]+(?:-[a-z0-9]+)*)\.(jpg|png|webp|avif|gif)\b/g;

/**
 * Rewrites slug aliases in a body to the library path they stand for, so the
 * build serves the photo from the media host in responsive sizes and the link
 * check finds its bytes. An alias that resolves to nothing, or to a different
 * file type, is left as written for the link check to report.
 */
export function canonicalImageLinks(
  markdown: string,
  media: readonly MediaAsset[],
  aliases: readonly { slug: string; mediaId: string }[] = [],
): string {
  if (!markdown.includes("/v1/images/")) return markdown;
  const byId = new Map(media.map((asset) => [asset.id as string, asset]));
  const bySlug = new Map<string, MediaAsset>();
  for (const alias of aliases) {
    const asset = byId.get(alias.mediaId);
    if (asset) bySlug.set(alias.slug, asset);
  }
  // A current slug wins over an old alias of the same name.
  for (const asset of media) if (asset.slug) bySlug.set(asset.slug, asset);

  return markdown.replace(SLUG_URL, (url, slug: string, extension: string) => {
    const asset = bySlug.get(slug);
    return asset && EXTENSIONS[asset.mimeType] === extension ? `/${asset.storageKey}` : url;
  });
}
