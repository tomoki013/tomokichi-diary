import { snapshot } from "./content";
import { mediaBaseUrl, mediaUrl } from "./site";

/**
 * Responsive image derivatives.
 *
 * Originals keep their existing public URLs — those are part of the migration
 * baseline — and every derivative is a rebuildable build artifact stored under
 * `/_img/`, never in the repository and never in the data model
 * (docs/adr/0007 and instruction §18, §26).
 */
export const DERIVATIVE_FORMATS = ["avif", "webp"] as const;
export type DerivativeFormat = (typeof DERIVATIVE_FORMATS)[number];

/** Widths the layout actually renders at; anything wider is wasted bytes. */
const LADDER = [340, 704, 1408];

const bySha = new Map(snapshot.media.map((asset) => [asset.storageKey, asset]));

export interface DerivativePlan {
  storageKey: string;
  sha: string;
  widths: number[];
}

function shortSha(sha256: string): string {
  return sha256.slice(0, 16);
}

/** Never upscales: a 509px original is served at 509px, not stretched to 704. */
export function widthsFor(intrinsicWidth: number | null): number[] {
  if (intrinsicWidth === null || intrinsicWidth <= 0) return [...LADDER];
  const widths = LADDER.filter((width) => width < intrinsicWidth);
  widths.push(Math.min(intrinsicWidth, LADDER.at(-1)!));
  return [...new Set(widths)].toSorted((a, b) => a - b);
}

export function derivativeKey(sha256: string, width: number, format: DerivativeFormat): string {
  return `_img/${shortSha(sha256)}-${width}.${format}`;
}

export function derivativeUrl(sha256: string, width: number, format: DerivativeFormat): string {
  return `${mediaBaseUrl}/${derivativeKey(sha256, width, format)}`;
}

export interface ImageSources {
  /** Fallback for browsers without AVIF or WebP; also the URL that must keep working. */
  src: string;
  width: number | null;
  height: number | null;
  sources: { type: string; srcset: string }[];
}

export function imageSources(storageKey: string): ImageSources {
  const asset = bySha.get(storageKey);
  const src = mediaUrl(storageKey);
  if (!asset) return { src, width: null, height: null, sources: [] };

  const widths = widthsFor(asset.width);
  return {
    src,
    width: asset.width,
    height: asset.height,
    sources: DERIVATIVE_FORMATS.map((format) => ({
      type: `image/${format}`,
      srcset: widths
        .map((width) => `${derivativeUrl(asset.sha256, width, format)} ${width}w`)
        .join(", "),
    })),
  };
}

/** Everything the build has to produce, derived from the snapshot rather than from render calls. */
export function derivativePlans(): DerivativePlan[] {
  return snapshot.media
    .filter((asset) => asset.mimeType.startsWith("image/") && asset.mimeType !== "image/svg+xml")
    .map((asset) => ({
      storageKey: asset.storageKey,
      sha: shortSha(asset.sha256),
      widths: widthsFor(asset.width),
    }));
}

/** How wide each slot renders, so the browser never downloads a larger candidate. */
export const SIZES = {
  card: "(max-width: 46rem) 92vw, (max-width: 72rem) 44vw, 21rem",
  hero: "(max-width: 46rem) 92vw, 44rem",
  body: "(max-width: 46rem) 92vw, 44rem",
  gallery: "(max-width: 40rem) 46vw, 14rem",
} as const;

const IMG_TAG = /<img\b([^>]*)>/gi;

/**
 * Rewrites the `<img>` tags Markdown produced into `<picture>` elements with
 * responsive sources.
 *
 * Done on the rendered HTML rather than in the Markdown pipeline so the body
 * stays plain Markdown and the same transform would work for any renderer
 * (ADR 0001).
 */
export function enhanceBodyImages(html: string): string {
  return html.replace(IMG_TAG, (tag, attrs: string) => {
    const src = /\ssrc="([^"]*)"/i.exec(attrs)?.[1];
    if (src === undefined || !src.startsWith("/images/")) return tag;

    const storageKey = src.replace(/^\/+/, "");
    const image = imageSources(storageKey);
    if (image.sources.length === 0) return tag.replace(src, image.src);

    const alt = /\salt="([^"]*)"/i.exec(attrs)?.[1] ?? "";
    const dimensions = [
      image.width === null ? "" : ` width="${image.width}"`,
      image.height === null ? "" : ` height="${image.height}"`,
    ].join("");
    const sources = image.sources
      .map(
        (source) =>
          `<source type="${source.type}" srcset="${source.srcset}" sizes="${SIZES.body}">`,
      )
      .join("");

    return `<picture>${sources}<img src="${image.src}" alt="${alt}"${dimensions} loading="lazy" decoding="async"></picture>`;
  });
}
