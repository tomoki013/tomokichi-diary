import type {
  ArticleDetailDto,
  ArticleMediaDto,
  ArticleSummaryDto,
  LocationDto,
  MediaAssetDto,
  RevisionDto,
  RouteDto,
} from "@tomokichi/contracts";
import type {
  Article,
  ArticleMedia,
  ArticleRevision,
  Location,
  LocationName,
  MediaAsset,
  Route,
} from "@tomokichi/domain";

/** Entities never leave the process as-is; these are the wire shapes. */
export function toRevisionDto(revision: ArticleRevision): RevisionDto {
  return {
    id: revision.id,
    revisionNumber: revision.revisionNumber,
    title: revision.title,
    summary: revision.summary,
    bodyMarkdown: revision.bodyMarkdown,
    seoTitleOverride: revision.seoTitleOverride,
    seoDescriptionOverride: revision.seoDescriptionOverride,
    changeSummary: revision.changeSummary,
    createdAt: revision.createdAt,
  };
}

export function toArticleSummaryDto(params: {
  article: Article;
  title: string;
  path: string | null;
  hasUnpublishedChanges: boolean;
  isLive: boolean;
}): ArticleSummaryDto {
  const { article } = params;
  return {
    id: article.id,
    kind: article.kind,
    slug: article.slug,
    title: params.title,
    status: article.status,
    locale: article.locale,
    path: params.path,
    publishedAt: article.publishedAt,
    scheduledAt: article.scheduledAt,
    updatedAt: article.updatedAt,
    hasUnpublishedChanges: params.hasUnpublishedChanges,
    isLive: params.isLive,
    noindex: article.noindex,
  };
}

/**
 * Storage key of the smallest derivative the publication build makes for an
 * asset (`scripts/media-build.ts`): 340px wide, or the original width when it
 * is narrower. Lists use it instead of the multi-megabyte original.
 */
export function thumbnailKey(asset: MediaAsset): string | null {
  if (!asset.mimeType.startsWith("image/") || asset.mimeType === "image/svg+xml") return null;
  if (!/^[a-f0-9]{16,}$/.test(asset.sha256)) return null;
  const width = asset.width !== null && asset.width > 0 && asset.width <= 340 ? asset.width : 340;
  return `_img/${asset.sha256.slice(0, 16)}-${width}.webp`;
}

export function toArticleMediaDto(
  usage: ArticleMedia,
  asset: MediaAsset | null,
  url: string,
  imageBase?: string,
  resolve?: (storageKey: string) => string,
): ArticleMediaDto {
  const thumb = asset && resolve ? thumbnailKey(asset) : null;
  return {
    mediaId: usage.mediaId,
    url: asset ? (publicImageUrl(asset, imageBase) ?? url) : url,
    thumbnailUrl: thumb && resolve ? resolve(thumb) : null,
    role: usage.role,
    sortOrder: usage.sortOrder,
    alt: usage.alt,
    caption: usage.caption,
    width: asset?.width ?? null,
    height: asset?.height ?? null,
  };
}

function publicImageUrl(
  asset: MediaAsset,
  imageBase = "https://api.tomokichidiary.com/v1/images",
): string | null {
  const extension = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/avif": "avif",
    "image/gif": "gif",
  }[asset.mimeType];
  return asset.slug && extension
    ? `${imageBase.replace(/\/+$/, "")}/${asset.slug}.${extension}`
    : null;
}

export function toMediaAssetDto(
  asset: MediaAsset,
  url: string,
  imageBase?: string,
  resolve?: (storageKey: string) => string,
): MediaAssetDto {
  const thumb = resolve ? thumbnailKey(asset) : null;
  return {
    id: asset.id,
    url,
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
    size: asset.size,
    originalName: asset.originalName ?? asset.storageKey.split("/").at(-1) ?? null,
    slug: asset.slug ?? null,
    aiGenerated: asset.aiGenerated ?? false,
    hashVerified: Boolean(asset.contentSha256),
    slugUrl: publicImageUrl(asset, imageBase),
    thumbnailUrl: thumb && resolve ? resolve(thumb) : null,
  };
}

export function toRouteDto(route: Route): RouteDto {
  return {
    path: route.path,
    targetType: route.targetType,
    targetId: route.targetId,
    isCanonical: route.isCanonical,
    redirectTo: route.redirectTo,
    noindex: route.noindex,
  };
}

export function toLocationDto(location: Location, names: readonly LocationName[]): LocationDto {
  return {
    id: location.id,
    slug: location.slug,
    type: location.type,
    parentId: location.parentId,
    name:
      names.find((name) => name.locationId === location.id && name.locale === "ja")?.name ??
      location.slug,
  };
}

export type { ArticleDetailDto };
