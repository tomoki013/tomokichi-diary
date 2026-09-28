import type { ArticleSummaryDto } from "@tomokichi/contracts";
import { api } from "../lib/api";
import { formatDateTime, formatRelative, ticketStatusLabels } from "../lib/labels";
import { href } from "../lib/route";
import { useResource, useTitle } from "../ui/hooks";
import { Badge, EmptyState, ErrorState, PageHeader, Panel, SkeletonRows } from "../ui/parts";

/**
 * What needs doing, not a summary for its own sake: unanswered inquiries,
 * drafts with unpublished changes, what is scheduled, and whether any URL is
 * broken. Each block loads on its own, so one slow source does not blank the
 * page.
 */
export function Dashboard() {
  useTitle("ホーム");
  const articles = useResource(() => api.listArticles().then((r) => r.items), "articles");
  const integrity = useResource(() => api.routeIntegrity(), "integrity");
  const inquiries = useResource(async () => {
    const status = await api.inquiryStatus();
    if (!status.configured || !status.registered) return { status, open: null };
    return { status, open: await api.listTickets({ status: "open" }) };
  }, "inquiries");

  const items = articles.data ?? [];
  const count = (predicate: (item: ArticleSummaryDto) => boolean): number =>
    items.filter(predicate).length;
  const pending = items
    .filter((item) => item.hasUnpublishedChanges || item.status === "draft")
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 8);
  const scheduled = items
    .filter((item) => item.status === "scheduled")
    .toSorted((a, b) => (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? ""));

  return (
    <>
      <PageHeader title="ホーム" />

      <div className="stats">
        <Stat
          label="未対応のお問い合わせ"
          value={inquiries.data?.open?.total}
          loading={inquiries.loading}
          href={href.inquiries()}
          tone={inquiries.data?.open?.total ? "accent" : "neutral"}
        />
        <Stat
          label="公開中"
          value={articles.data ? count((item) => item.isLive) : undefined}
          loading={articles.loading}
          href={href.articles()}
        />
        <Stat
          label="未公開の変更"
          value={articles.data ? count((item) => item.hasUnpublishedChanges) : undefined}
          loading={articles.loading}
          href={href.articles()}
        />
        <Stat
          label="下書き"
          value={articles.data ? count((item) => item.status === "draft") : undefined}
          loading={articles.loading}
          href={href.articles()}
        />
        <Stat
          label="URL の問題"
          value={integrity.data?.problems.length}
          loading={integrity.loading}
          href={href.routes()}
          tone={integrity.data?.problems.length ? "danger" : "neutral"}
        />
      </div>

      <div className="grid-2">
        <Panel title="未対応のお問い合わせ" actions={<a href={href.inquiries()}>すべて →</a>}>
          {inquiries.error ? (
            <ErrorState error={inquiries.error} onRetry={() => void inquiries.reload()} />
          ) : inquiries.loading ? (
            <SkeletonRows rows={4} />
          ) : !inquiries.data?.status.configured ? (
            <EmptyState>共通お問い合わせ基盤への接続が未設定です。</EmptyState>
          ) : !inquiries.data.status.registered ? (
            <EmptyState>このサイトが基盤に登録されていません。</EmptyState>
          ) : inquiries.data.open?.items.length === 0 ? (
            <EmptyState>未対応はありません。</EmptyState>
          ) : (
            <ul className="rows">
              {inquiries.data.open?.items.slice(0, 6).map((ticket) => (
                <li key={ticket.id}>
                  <a href={href.inquiry(ticket.id)} className="rows__main">
                    {ticket.subject}
                  </a>
                  <Badge tone={ticket.status === "NEW" ? "accent" : "neutral"}>
                    {ticketStatusLabels[ticket.status]}
                  </Badge>
                  <span className="muted">{formatRelative(ticket.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="公開待ち" actions={<a href={href.articles()}>記事一覧 →</a>}>
          {articles.error ? (
            <ErrorState error={articles.error} onRetry={() => void articles.reload()} />
          ) : articles.loading ? (
            <SkeletonRows rows={4} />
          ) : pending.length === 0 ? (
            <EmptyState>未公開の変更はありません。</EmptyState>
          ) : (
            <ul className="rows">
              {pending.map((item) => (
                <li key={item.id}>
                  <a href={href.article(item.id)} className="rows__main">
                    {item.title || item.slug}
                  </a>
                  <Badge tone={item.status === "draft" ? "neutral" : "warn"}>
                    {item.status === "draft" ? "下書き" : "未公開の変更"}
                  </Badge>
                  <span className="muted">{formatRelative(item.updatedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {scheduled.length > 0 && (
          <Panel title="予約公開">
            <ul className="rows">
              {scheduled.map((item) => (
                <li key={item.id}>
                  <a href={href.article(item.id)} className="rows__main">
                    {item.title || item.slug}
                  </a>
                  <span className="muted">{formatDateTime(item.scheduledAt)}</span>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {integrity.data && integrity.data.problems.length > 0 && (
          <Panel title="URL の問題" actions={<a href={href.routes()}>URL 管理 →</a>}>
            <ul className="problems">
              {integrity.data.problems.slice(0, 6).map((problem) => (
                <li key={`${problem.code}-${problem.target ?? ""}`}>{problem.message}</li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  loading,
  href: link,
  tone = "neutral",
}: {
  label: string;
  value: number | undefined;
  loading: boolean;
  href: string;
  tone?: "neutral" | "accent" | "danger";
}) {
  return (
    <a className={`stat stat--${tone}`} href={link}>
      <span className="stat__label">{label}</span>
      <span className="stat__value">
        {value !== undefined ? value : loading ? <span className="skeleton skeleton--num" /> : "—"}
      </span>
    </a>
  );
}
