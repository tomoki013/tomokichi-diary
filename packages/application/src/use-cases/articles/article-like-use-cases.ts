import type { ArticleId } from "@tomokichi/domain";
import type { AppContext } from "../../context.js";

export interface ArticleLikeState {
  readonly count: number;
  readonly liked: boolean;
}

export async function getArticleLikeState(
  ctx: AppContext,
  articleId: ArticleId,
  visitorHash?: string,
): Promise<ArticleLikeState | null> {
  const article = await ctx.repos.articles.findById(articleId);
  if (!article || article.status !== "published") return null;

  const [count, liked] = await Promise.all([
    ctx.repos.articleLikes.count(articleId),
    visitorHash ? ctx.repos.articleLikes.has(articleId, visitorHash) : Promise.resolve(false),
  ]);
  return { count, liked };
}

export async function toggleArticleLike(
  ctx: AppContext,
  articleId: ArticleId,
  visitorHash: string,
): Promise<ArticleLikeState | null> {
  const article = await ctx.repos.articles.findById(articleId);
  if (!article || article.status !== "published") return null;

  const liked = await ctx.repos.articleLikes.has(articleId, visitorHash);
  if (liked) {
    await ctx.repos.articleLikes.remove(articleId, visitorHash);
  } else {
    await ctx.repos.articleLikes.add(articleId, visitorHash, ctx.clock.now());
  }
  return { count: await ctx.repos.articleLikes.count(articleId), liked: !liked };
}
