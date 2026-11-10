import {
  MAX_UPLOAD_BYTES,
  setMediaAiGenerated,
  updateMediaSlug,
  uploadMediaWithResult,
  type AppContext,
} from "@tomokichi/application";
import type { MediaAssetDto } from "@tomokichi/contracts";
import type { MediaAsset, MediaId } from "@tomokichi/domain";
import { toMediaAssetDto } from "../../mappers.js";
import { invalid, OpError, unwrap, type Handlers, type OpScope } from "../scope.js";

type Names = "media.list" | "media.hashStatus" | "media.lookup" | "media.update" | "media.upload";

/**
 * Every word must appear in the slug, the uploaded file name, the storage key,
 * or `areas` (the areas of the articles that use the photo). The full public
 * URL is left out on purpose: every asset shares its host and extension, so a
 * query like "jpg" used to match the whole library.
 */
export function matchesMediaQuery(asset: MediaAsset, query: string, areas = ""): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [asset.slug, asset.originalName, asset.storageKey, areas]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/**
 * Media id → searchable area text. A photo has no area of its own, so it takes
 * the areas of every article that uses it, with their parents, so "京都" also
 * finds photos from an article filed under 伏見.
 */
async function mediaAreaText(ctx: AppContext): Promise<Map<string, string>> {
  const [usages, articleLocations, locations, names] = await Promise.all([
    ctx.repos.media.listAllUsages(),
    ctx.repos.relations.listArticleLocations(),
    ctx.repos.locations.listAll(),
    ctx.repos.locations.listNames(),
  ]);
  const parentOf = new Map<string, string | null>(
    locations.map((location) => [location.id, location.parentId]),
  );
  const termsOf = new Map<string, string[]>(
    locations.map((location) => [location.id, [location.slug]]),
  );
  for (const name of names)
    termsOf
      .get(name.locationId)
      ?.push(
        ...[name.name, name.shortName, name.romanizedName].filter(
          (value): value is string => !!value,
        ),
      );
  const areaTerms = (locationId: string) => {
    const terms: string[] = [];
    const seen = new Set<string>();
    for (let id: string | null = locationId; id && !seen.has(id); id = parentOf.get(id) ?? null) {
      seen.add(id);
      terms.push(...(termsOf.get(id) ?? []));
    }
    return terms;
  };
  const byArticle = new Map<string, string[]>();
  for (const { articleId, locationId } of articleLocations)
    byArticle.set(articleId, [...(byArticle.get(articleId) ?? []), ...areaTerms(locationId)]);
  const byMedia = new Map<string, Set<string>>();
  for (const { articleId, mediaId } of usages) {
    const terms = byArticle.get(articleId);
    if (!terms) continue;
    const set = byMedia.get(mediaId) ?? new Set<string>();
    for (const term of terms) set.add(term);
    byMedia.set(mediaId, set);
  }
  return new Map([...byMedia].map(([id, terms]) => [id, [...terms].join(" ")]));
}

const dto = ({ ctx, env }: OpScope, asset: MediaAsset): MediaAssetDto =>
  toMediaAssetDto(asset, ctx.mediaUrls.resolve(asset.storageKey), env.PUBLIC_IMAGE_URL, (key) =>
    ctx.mediaUrls.resolve(key),
  );

function decodeBase64(data: string): ArrayBuffer {
  let binary: string;
  try {
    binary = atob(data.replace(/^data:[^,]*,/, "").replace(/\s+/g, ""));
  } catch {
    throw invalid("dataBase64 を Base64 として読めません", "dataBase64");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

export const mediaHandlers: Handlers<Names> = {
  // Searched and paged here, so the library never ships every asset to a client.
  "media.list": async (scope, { query, offset, limit }) => {
    const { ctx } = scope;
    const assets = (await ctx.repos.media.listAll()).toSorted((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
    // Area lookups cost four more reads, so only a real search pays for them.
    const areas = query.trim() === "" ? new Map<string, string>() : await mediaAreaText(ctx);
    const matching = assets.filter((asset) => matchesMediaQuery(asset, query, areas.get(asset.id)));
    const page = matching.slice(offset, offset + limit);
    const next = offset + page.length;
    return {
      items: page.map((asset) => dto(scope, asset)),
      total: matching.length,
      nextOffset: next < matching.length ? next : null,
    };
  },

  "media.hashStatus": ({ ctx }) => ctx.repos.media.hashStatus(),

  "media.lookup": async (scope, { sha256 }) => {
    const asset = await scope.ctx.repos.media.findBySha256(sha256);
    return { asset: asset ? dto(scope, asset) : null };
  },

  "media.update": async (scope, { mediaId, slug, aiGenerated }) => {
    if (slug === undefined && aiGenerated === undefined)
      throw invalid("slug か aiGenerated のどちらかを指定してください");
    const { ctx } = scope;
    const id = mediaId as MediaId;
    let asset: MediaAsset | undefined;
    if (slug !== undefined) asset = unwrap(await updateMediaSlug(ctx, id, slug));
    if (aiGenerated !== undefined) asset = unwrap(await setMediaAiGenerated(ctx, id, aiGenerated));
    return dto(scope, asset!);
  },

  "media.upload": async (scope, { slug, filename, mimeType, dataBase64 }) => {
    if (scope.env.MEDIA_UPLOADS_PAUSED === "1")
      throw new OpError(
        "API_CONFLICT",
        "画像のメンテナンス中です。しばらくしてから再試行してください",
        503,
      );
    if (!slug.trim()) throw invalid("公開画像Slugを入力してください", "slug");
    const body = scope.upload?.body ?? (dataBase64 ? decodeBase64(dataBase64) : null);
    if (!body) throw invalid("画像ファイルがありません", "dataBase64");
    if (body.byteLength > MAX_UPLOAD_BYTES)
      throw invalid("画像は20MB以下のファイルを指定してください", "dataBase64");
    const result = unwrap(
      await uploadMediaWithResult(scope.ctx, {
        body,
        mimeType: scope.upload?.mimeType ?? mimeType,
        originalName: scope.upload?.name ?? filename,
        slug,
      }),
    );
    return { ...dto(scope, result.asset), duplicate: result.duplicate };
  },
};
