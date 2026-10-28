import type { ArticleMedia, MediaAsset } from "@tomokichi/domain";

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

/** Where slug aliases are served when the API is not told otherwise. */
export const DEFAULT_IMAGE_BASE = "https://api.tomokichidiary.com/v1/images";

// `![alt](url)` or `![alt](<url> "title")`. HTML `<img>` is left alone.
const MARKDOWN_IMAGE = /!\[([^\]]*)\]\(\s*(<[^>]+>|[^\s)]+)((?:\s+"[^"]*")?\s*)\)/g;

export interface BodyImage {
  readonly asset: MediaAsset;
  readonly alt: string;
  /** Every URL the body shows the photo by, as written. */
  readonly urls: readonly string[];
}

export interface BodyImageLinks {
  /** The body with every library photo that has a slug pointing at its slug alias. */
  readonly markdown: string;
  /** Library photos the body shows, first appearance first. */
  readonly images: readonly BodyImage[];
}

/**
 * Finds the library photos a body shows, whether written as a media host URL,
 * a `/images/…` path or a slug alias, and points each one that has a slug at
 * its alias so a body never mixes the two forms. A link to anything outside
 * the library is left as written.
 */
export function linkBodyImages(
  markdown: string,
  media: readonly MediaAsset[],
  aliases: readonly { slug: string; mediaId: string }[],
  urls: { readonly resolve: (storageKey: string) => string; readonly imageBase?: string },
): BodyImageLinks {
  if (!markdown.includes("![")) return { markdown, images: [] };
  const imageBase = (urls.imageBase ?? DEFAULT_IMAGE_BASE).replace(/\/+$/, "");
  const byId = new Map(media.map((asset) => [asset.id as string, asset]));
  const byKey = new Map(media.map((asset) => [asset.storageKey, asset]));
  const byUrl = new Map(media.map((asset) => [urls.resolve(asset.storageKey), asset]));
  const bySlug = new Map<string, MediaAsset>();
  for (const alias of aliases) {
    const asset = byId.get(alias.mediaId);
    if (asset) bySlug.set(alias.slug, asset);
  }
  for (const asset of media) if (asset.slug) bySlug.set(asset.slug, asset);

  const find = (url: string): MediaAsset | undefined => {
    const bare = url.replace(/[?#].*$/, "");
    const slugged = /\/v1\/images\/([a-z0-9]+(?:-[a-z0-9]+)*)\.(jpg|png|webp|avif|gif)$/.exec(bare);
    if (slugged) {
      const asset = bySlug.get(slugged[1]!);
      return asset && EXTENSIONS[asset.mimeType] === slugged[2] ? asset : undefined;
    }
    return byUrl.get(bare) ?? (bare.startsWith("/") ? byKey.get(bare.slice(1)) : undefined);
  };

  const images = new Map<string, { asset: MediaAsset; alt: string; urls: string[] }>();
  const linked = markdown.replace(
    MARKDOWN_IMAGE,
    (whole, alt: string, written: string, title: string) => {
      const url = written.startsWith("<") ? written.slice(1, -1) : written;
      const asset = find(url);
      if (!asset) return whole;
      const image = images.get(asset.id);
      if (!image) images.set(asset.id, { asset, alt: alt.trim(), urls: [url] });
      else if (!image.urls.includes(url)) image.urls.push(url);
      const extension = EXTENSIONS[asset.mimeType];
      if (!asset.slug || !extension) return whole;
      return `![${alt}](${imageBase}/${asset.slug}.${extension}${title})`;
    },
  );
  return { markdown: linked, images: [...images.values()] };
}

/**
 * Adds a body photo the article does not list yet as an inline usage, so a
 * photo pasted straight into the body still shows in the editor, the gallery
 * and the library's usage counts. Nothing is removed: a photo can be listed
 * without appearing in the body (a cover, a gallery photo, one not placed yet).
 */
export function withBodyUsages(
  articleId: ArticleMedia["articleId"],
  usages: readonly ArticleMedia[],
  images: readonly BodyImage[],
): readonly ArticleMedia[] {
  const listed = new Set(usages.map((usage) => usage.mediaId as string));
  let sortOrder = Math.max(-1, ...usages.map((usage) => usage.sortOrder));
  const added = images
    .filter((image) => !listed.has(image.asset.id))
    .map((image): ArticleMedia => ({
      articleId,
      mediaId: image.asset.id,
      role: "inline",
      sortOrder: ++sortOrder,
      // Usages require alt text; an empty Markdown alt falls back to the file name.
      alt:
        image.alt ||
        (image.asset.originalName ?? image.asset.storageKey.split("/").at(-1) ?? "写真").replace(
          /\.[a-z0-9]+$/i,
          "",
        ),
      caption: null,
    }));
  return added.length ? [...usages, ...added] : usages;
}
