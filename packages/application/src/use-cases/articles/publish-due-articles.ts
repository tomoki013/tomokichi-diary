import type { AppContext } from "../../context.js";
import { publishArticle } from "./article-use-cases.js";

/** Scheduled publication performs the same validated pointer swap as Publish. */
export async function publishDueArticles(ctx: AppContext): Promise<number> {
  const now = ctx.clock.now();
  const due = (await ctx.repos.articles.listAll()).filter(
    (a) => a.status === "scheduled" && a.scheduledAt && a.scheduledAt <= now,
  );
  let count = 0;
  for (const article of due) {
    const result = await publishArticle(ctx, article.id);
    if (result.ok) count++;
    else ctx.logger.warn("article.scheduled_publish_rejected", { articleId: article.id });
  }
  return count;
}
