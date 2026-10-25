import type { MediaId } from "@tomokichi/domain";
import type { AppContext } from "../../context.js";
import type { ArticleLikeState } from "../articles/article-like-use-cases.js";

/** Same answer shape as an article like, so one client paints both. */
export type MediaLikeState = ArticleLikeState;

/** Only photographs the gallery can show take likes. */
async function likeable(ctx: AppContext, mediaId: MediaId): Promise<boolean> {
  const asset = await ctx.repos.media.findById(mediaId);
  return asset !== null && !asset.aiGenerated;
}

export async function getMediaLikeState(
  ctx: AppContext,
  mediaId: MediaId,
  visitorHash?: string,
): Promise<MediaLikeState | null> {
  if (!(await likeable(ctx, mediaId))) return null;
  const [count, liked] = await Promise.all([
    ctx.repos.mediaLikes.count(mediaId),
    visitorHash ? ctx.repos.mediaLikes.has(mediaId, visitorHash) : Promise.resolve(false),
  ]);
  return { count, liked };
}

/** Counts for every photograph with at least one like, in one read. */
export async function listMediaLikeCounts(ctx: AppContext): Promise<Record<string, number>> {
  const counts = await ctx.repos.mediaLikes.countAll();
  return Object.fromEntries(counts.map((entry) => [entry.mediaId, entry.count]));
}

export async function toggleMediaLike(
  ctx: AppContext,
  mediaId: MediaId,
  visitorHash: string,
): Promise<MediaLikeState | null> {
  if (!(await likeable(ctx, mediaId))) return null;
  const liked = await ctx.repos.mediaLikes.has(mediaId, visitorHash);
  if (liked) {
    await ctx.repos.mediaLikes.remove(mediaId, visitorHash);
  } else {
    await ctx.repos.mediaLikes.add(mediaId, visitorHash, ctx.clock.now());
  }
  return { count: await ctx.repos.mediaLikes.count(mediaId), liked: !liked };
}
