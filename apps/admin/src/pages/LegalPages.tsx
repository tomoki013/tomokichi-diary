import { api } from "../lib/api";
import { formatDateTime } from "../lib/labels";
import { href } from "../lib/route";
import { PhaseBadge } from "../ui/PhaseBadge";
import { useResource, useTitle } from "../ui/hooks";
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from "../ui/parts";

const SITE = "https://tomokichidiary.com";

/**
 * The site policies (privacy, terms, cookies, editorial, affiliates). They are
 * standalone pages under /legal/, edited and published with the same editor
 * and the same rule as articles; this screen only gathers them in one place.
 */
export function LegalPages() {
  useTitle("サイトポリシー");
  const pages = useResource(
    () =>
      api
        .listArticles()
        .then((r) =>
          r.items
            .filter((item) => item.kind === "page" && (item.path ?? "").startsWith("/legal/"))
            .toSorted((a, b) => (a.path ?? "").localeCompare(b.path ?? "")),
        ),
    "articles:legal",
  );

  return (
    <>
      <PageHeader title="サイトポリシー" meta={pages.data && `${pages.data.length}件`} />
      <p className="muted">
        プライバシーポリシー・利用規約などの法務系の文書です。「編集」で記事と同じ編集画面が開きます。本文を直して保存し、「変更を公開」でサイトに反映されます。URL（/legal/…）は変わりません。
      </p>
      {pages.error ? (
        <ErrorState error={pages.error} onRetry={() => void pages.reload()} />
      ) : !pages.data ? (
        <SkeletonRows rows={5} />
      ) : pages.data.length === 0 ? (
        <EmptyState>サイトポリシーのページがありません。</EmptyState>
      ) : (
        <ul className="series-list">
          {pages.data.map((page) => (
            <li key={page.id}>
              <PhaseBadge article={page} />
              <div className="series-list__body">
                <a href={href.article(page.id)}>
                  <strong>{page.title}</strong>
                </a>
                <small>
                  {page.path} ・ 更新 {formatDateTime(page.contentUpdatedAt ?? page.updatedAt)}
                </small>
              </div>
              <div className="series-list__actions">
                <a href={href.article(page.id)}>編集</a>
                {page.path && page.isLive && (
                  <a href={`${SITE}${page.path}`} target="_blank" rel="noopener noreferrer">
                    公開ページ ↗
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
