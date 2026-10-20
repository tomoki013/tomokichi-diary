import { useMemo } from "react";
import { api } from "../lib/api";
import { formatDateTime, formatRelative } from "../lib/labels";
import { href } from "../lib/route";
import { useResource, useTitle } from "../ui/hooks";
import { EmptyState, ErrorState, PageHeader, Panel, SkeletonRows } from "../ui/parts";

/**
 * Who liked what, and when. A "person" is one browser: likes are anonymous and
 * keyed by a hashed browser id, so the same reader on two devices counts twice.
 * Titles come from the article list rather than the likes endpoint, which only
 * knows ids.
 */
export function Likes() {
  useTitle("いいね");
  const activity = useResource(() => api.likeActivity(), "likes");
  const articles = useResource(() => api.listArticles().then((r) => r.items), "articles");

  const byId = useMemo(
    () => new Map((articles.data ?? []).map((article) => [article.id, article])),
    [articles.data],
  );
  const titleOf = (articleId: string) => {
    const article = byId.get(articleId);
    return article ? article.title || article.slug : articles.loading ? "…" : "（削除された記事）";
  };

  const data = activity.data;

  return (
    <>
      <PageHeader title="いいね" meta={data && `合計${data.total}件`} />

      {activity.error ? (
        <ErrorState error={activity.error} onRetry={() => void activity.reload()} />
      ) : !data ? (
        <SkeletonRows rows={8} />
      ) : data.total === 0 ? (
        <EmptyState>まだいいねはありません。</EmptyState>
      ) : (
        <>
          <div className="stats">
            <div className="stat stat--accent">
              <span className="stat__label">いいね</span>
              <span className="stat__value">{data.total}</span>
            </div>
            <div className="stat">
              <span className="stat__label">いいねした人（ブラウザ単位）</span>
              <span className="stat__value">{data.visitors}</span>
            </div>
            <div className="stat">
              <span className="stat__label">いいねされた記事</span>
              <span className="stat__value">{data.articles.length}</span>
            </div>
          </div>

          <div className="grid-2">
            <Panel title="記事別">
              <table className="table">
                <thead>
                  <tr>
                    <th>記事</th>
                    <th className="nowrap">数</th>
                    <th className="nowrap">最後</th>
                  </tr>
                </thead>
                <tbody>
                  {data.articles.map((row) => (
                    <tr key={row.articleId}>
                      <td>
                        <a className="table__title" href={href.article(row.articleId)}>
                          {titleOf(row.articleId)}
                        </a>
                      </td>
                      <td className="nowrap">{row.count}</td>
                      <td className="muted nowrap" title={formatDateTime(row.lastLikedAt)}>
                        {formatRelative(row.lastLikedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>

            <Panel title={`最近のいいね（${data.recent.length}件）`}>
              <ul className="rows">
                {data.recent.map((row) => (
                  <li key={`${row.articleId}-${row.createdAt}`}>
                    <span className="muted small nowrap">{formatDateTime(row.createdAt)}</span>
                    <a className="rows__main" href={href.article(row.articleId)}>
                      {titleOf(row.articleId)}
                    </a>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </>
      )}
    </>
  );
}
