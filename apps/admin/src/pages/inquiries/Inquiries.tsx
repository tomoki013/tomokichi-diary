import { useState, type FormEvent } from "react";
import type { InquiryStatusDto } from "@tomokichi/contracts";
import { api } from "../../lib/api";
import { formatDateTime, formatRelative, ticketStatusLabels } from "../../lib/labels";
import { href } from "../../lib/route";
import { useResource, useTitle } from "../../ui/hooks";
import { Badge, EmptyState, ErrorState, PageHeader, Panel, SkeletonRows } from "../../ui/parts";

const FILTERS = [
  { key: "open", label: "未対応" },
  { key: "NEW", label: "新規" },
  { key: "WAITING_CUSTOMER", label: "返事待ち" },
  { key: "RESOLVED", label: "解決済み" },
  { key: "CLOSED", label: "クローズ" },
  { key: "", label: "すべて" },
] as const;

/**
 * This site's tickets on the shared inquiry platform. Contact-form messages
 * land here; replies are sent from the platform's mail address.
 */
export function Inquiries() {
  useTitle("お問い合わせ");
  const status = useResource(() => api.inquiryStatus(), "inquiry-status");
  const [filter, setFilter] = useState<string>("open");
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [offset, setOffset] = useState(0);
  const ready = status.data?.configured === true && status.data.registered;

  const tickets = useResource(
    () =>
      ready ? api.listTickets({ status: filter, query: submitted, offset }) : Promise.resolve(null),
    `tickets:${ready}:${filter}:${submitted}:${offset}`,
  );

  const search = (event: FormEvent): void => {
    event.preventDefault();
    setOffset(0);
    setSubmitted(query.trim());
  };

  return (
    <>
      <PageHeader
        title="お問い合わせ"
        meta={
          <>
            {tickets.data && <span>{tickets.data.total}件</span>}
            <a href={href.legacyMessages()}>切替前の受信箱 →</a>
          </>
        }
      />

      {status.error ? (
        <ErrorState error={status.error} onRetry={() => void status.reload()} />
      ) : status.data && !ready ? (
        <Setup status={status.data} />
      ) : (
        <>
          <div className="toolbar">
            <fieldset className="chips">
              <legend className="sr-only">状態で絞り込む</legend>
              {FILTERS.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  className="chip"
                  aria-pressed={filter === entry.key}
                  onClick={() => {
                    setFilter(entry.key);
                    setOffset(0);
                  }}
                >
                  {entry.label}
                </button>
              ))}
            </fieldset>
            <form onSubmit={search}>
              <input
                type="search"
                aria-label="件名・本文・メールアドレスで検索"
                placeholder="件名・本文・アドレス"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </form>
          </div>

          <Panel className="panel--flush">
            {tickets.error ? (
              <ErrorState error={tickets.error} onRetry={() => void tickets.reload()} />
            ) : tickets.loading || !tickets.data ? (
              <SkeletonRows rows={8} />
            ) : tickets.data.items.length === 0 ? (
              <EmptyState>該当するお問い合わせはありません。</EmptyState>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>件名</th>
                    <th>状態</th>
                    <th className="hide-narrow">差出人</th>
                    <th>受付</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.data.items.map((ticket) => (
                    <tr
                      key={ticket.id}
                      className={ticket.status === "NEW" ? "row--unread" : undefined}
                    >
                      <td>
                        <a className="table__title" href={href.inquiry(ticket.id)}>
                          {ticket.subject}
                        </a>
                        <span className="muted small mono"> {ticket.number}</span>
                        {ticket.nextAction && (
                          <div className="muted small">次: {ticket.nextAction}</div>
                        )}
                      </td>
                      <td className="nowrap">
                        <Badge tone={ticket.status === "NEW" ? "accent" : "neutral"}>
                          {ticketStatusLabels[ticket.status]}
                        </Badge>
                        {ticket.slaState !== "OK" && (
                          <Badge tone="danger">
                            {ticket.slaState === "BREACHED" ? "期限超過" : "期限間近"}
                          </Badge>
                        )}
                      </td>
                      <td className="hide-narrow muted">{ticket.requesterEmail ?? "返信不要"}</td>
                      <td className="muted nowrap" title={formatDateTime(ticket.createdAt)}>
                        {formatRelative(ticket.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          {tickets.data && tickets.data.total > tickets.data.limit && (
            <div className="pager">
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - tickets.data!.limit))}
              >
                ← 前へ
              </button>
              <span className="muted">
                {offset + 1}–{offset + tickets.data.items.length} / {tickets.data.total}
              </span>
              <button
                type="button"
                disabled={!tickets.data.hasMore}
                onClick={() => setOffset(offset + tickets.data!.limit)}
              >
                次へ →
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}

/** What is missing before the screen can work, in the order it has to be done. */
function Setup({ status }: { status: InquiryStatusDto }) {
  return (
    <Panel title="共通お問い合わせ基盤への接続">
      <ol className="setup">
        <li className={status.configured ? "setup--done" : undefined}>
          API に基盤の接続先とサービストークンを設定する（<code>INQUIRY_API_ORIGIN</code>、
          <code>INQUIRY_ACCESS_CLIENT_ID</code>、<code>INQUIRY_ACCESS_CLIENT_SECRET</code>）
        </li>
        <li className={status.registered ? "setup--done" : undefined}>
          基盤に <code>tomokichi-diary</code> を Project として登録する
        </li>
      </ol>
      {status.configured && !status.registered && (
        <p className="form-error">
          登録されるまで、お問い合わせフォームからの送信は基盤に拒否されます。
        </p>
      )}
    </Panel>
  );
}
