import type { ArticleSummaryDto } from "@tomokichi/contracts";
import { api, ApiError, describeError, type PublicationStatus } from "./api";
import { publishProblem } from "./publish-messages";

export function canSelectForPublication(article: ArticleSummaryDto): boolean {
  return (
    (article.status === "draft" || article.status === "published") &&
    (!article.isLive || article.hasUnpublishedChanges)
  );
}

export interface BulkPublishItem {
  article: ArticleSummaryDto;
  published: boolean;
  error: string | null;
}

export interface BulkPublishResult {
  items: BulkPublishItem[];
  publication: PublicationStatus | null;
  buildError: string | null;
}

type Client = Pick<typeof api, "publish" | "retryPublication">;

/** One article per request fits D1's Free invocation limit. Dispatch once at the end. */
export async function publishSelection(
  articles: readonly ArticleSummaryDto[],
  onProgress: (completed: number) => void,
  client: Client = api,
): Promise<BulkPublishResult> {
  const result: BulkPublishResult = { items: [], publication: null, buildError: null };
  let needsBuild = false;
  let sessionExpired = false;
  for (const article of articles) {
    if (sessionExpired) {
      result.items.push({
        article,
        published: false,
        error: "サインイン後にもう一度公開してください",
      });
      continue;
    }
    try {
      const response = await client.publish(article.id, true);
      needsBuild = true;
      result.publication = response.publication;
      result.items.push({ article, published: true, error: null });
    } catch (error) {
      sessionExpired = error instanceof ApiError && error.status === 401;
      const uncertain = !(error instanceof ApiError) || error.status >= 500;
      // The request may have committed before its response was lost. Queue a
      // build and leave the item selected so retrying can safely confirm it.
      needsBuild ||= uncertain;
      const message =
        error instanceof ApiError && error.issues.length > 0
          ? error.issues.map((issue) => publishProblem(issue.message)).join("、")
          : describeError(error);
      result.items.push({
        article,
        published: false,
        error: uncertain
          ? `公開結果を確認できませんでした。再読み込みして確認してください（${message}）`
          : message,
      });
    }
    onProgress(result.items.length);
  }
  if (needsBuild && !sessionExpired) {
    try {
      result.publication = await client.retryPublication();
    } catch (error) {
      result.buildError = describeError(error);
    }
  }
  return result;
}
