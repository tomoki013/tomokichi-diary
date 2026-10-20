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

/**
 * Like counts for every published article in one read, so a listing can sort
 * by them without a request per card. Articles without a like are left out.
 */
export async function listArticleLikeCounts(ctx: AppContext): Promise<Record<string, number>> {
  const [articles, counts] = await Promise.all([
    ctx.repos.articles.listAll(),
    ctx.repos.articleLikes.countAll(),
  ]);
  const published = new Set(
    articles.filter((article) => article.status === "published").map((article) => article.id),
  );
  return Object.fromEntries(
    counts
      .filter(({ articleId, count }) => count > 0 && published.has(articleId))
      .map(({ articleId, count }) => [articleId, count]),
  );
}

export interface LikeActivity {
  readonly total: number;
  readonly visitors: number;
  readonly articles: readonly { articleId: ArticleId; count: number; lastLikedAt: string }[];
  readonly recent: readonly { articleId: ArticleId; createdAt: string }[];
}

/**
 * The admin's view of likes: totals, every liked article (any status, so a
 * like on an article that was later unpublished is not hidden) and the most
 * recent individual likes. Visitor hashes never leave the repository.
 */
export async function getLikeActivity(ctx: AppContext, recentLimit = 100): Promise<LikeActivity> {
  const [counts, visitors, recent] = await Promise.all([
    ctx.repos.articleLikes.countAll(),
    ctx.repos.articleLikes.countVisitors(),
    ctx.repos.articleLikes.listRecent(recentLimit),
  ]);
  return {
    total: counts.reduce((sum, row) => sum + row.count, 0),
    visitors,
    articles: counts.toSorted(
      (a, b) => b.count - a.count || b.lastLikedAt.localeCompare(a.lastLikedAt),
    ),
    recent,
  };
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
