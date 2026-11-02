import { useState, type FormEvent } from "react";
import type {
  InquiryCountsDto,
  InquiryStatusDto,
  InquiryTicketStatus,
  InquiryTicketSummaryDto,
} from "@tomokichi/contracts";
import { api } from "../../lib/api";
import {
  formatDateTime,
  formatRelative,
  isOpenTicket,
  isPast,
  ticketStatusLabels,
} from "../../lib/labels";
import { href } from "../../lib/route";
import { useResource, useTitle } from "../../ui/hooks";
import { EmptyState, ErrorState, PageHeader, Panel, SkeletonRows } from "../../ui/parts";
import { LaneBadge, SlaBadge, StatusBadge } from "./InquiryDetail";

const STATUS_ORDER: readonly InquiryTicketStatus[] = [
  "NEW",
  "TRIAGE",
  "ACKNOWLEDGED",
  "IN_PROGRESS",
  "WAITING_CUSTOMER",
  "WAITING_INTERNAL",
  "RESOLVED",
  "CLOSED",
];

/**
 * Every one of this site's tickets on one screen: what is waiting counted at
 * the top, then the whole list, open ones first and newest first, narrowed by
 * status, lane (一般 / メディア・お仕事) or a search. Replies are written on
 * each ticket and sent from the platform's mail address.
 */
export function Inquiries() {
  useTitle("お問い合わせ");
  const status = useResource(() => api.inquiryStatus(), "inquiry-status");
  const [filter, setFilter] = useState<string>("");
  const [lane, setLane] = useState<string>("");
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [offset, setOffset] = useState(0);
  const ready = status.data?.configured === true && status.data.registered;

  const tickets = useResource(
    () =>
      ready
        ? api.listTickets({ status: filter, lane, query: submitted, offset })
        : Promise.resolve(null),
    `tickets:${ready}:${filter}:${lane}:${submitted}:${offset}`,
  );
  const counts = tickets.data?.counts;

  const show = (next: { status?: string; lane?: string }): void => {
    setFilter(next.status ?? "");
    setLane(next.lane ?? "");
    setOffset(0);
  };
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
            {counts && <span>全{counts.all}件</span>}
            <a href={href.inquirySettings()}>署名・テンプレート →</a>
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
          <Summary
            counts={counts}
            status={status.data}
            current={{ status: filter, lane }}
            show={show}
          />

          <div className="toolbar">
            <select
              aria-label="状態で絞り込む"
              value={filter}
              onChange={(event) => show({ status: event.target.value, lane })}
            >
              <option value="">すべての状態{counts ? `（${counts.all}）` : ""}</option>
              <option value="open">未対応{counts ? `（${counts.open}）` : ""}</option>
              {STATUS_ORDER.map((key) => (
                <option key={key} value={key}>
                  {ticketStatusLabels[key]}
                  {counts ? `（${counts.byStatus[key] ?? 0}）` : ""}
                </option>
              ))}
            </select>
            <fieldset className="chips">
              <legend className="sr-only">動線で絞り込む</legend>
              {[{ key: "", label: "すべて" }, ...(status.data?.lanes ?? [])].map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  className="chip"
                  aria-pressed={lane === entry.key}
                  onClick={() => show({ status: filter, lane: entry.key })}
                >
                  {entry.label}
                </button>
              ))}
            </fieldset>
            <form onSubmit={search}>
              <input
                type="search"
                aria-label="件名・本文・メールアドレスで検索"
                placeholder="件名・本文・アドレス・番号"
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
              <EmptyState>
                {filter === "open"
                  ? "対応が必要なお問い合わせはありません。"
                  : "該当するお問い合わせはありません。"}
              </EmptyState>
            ) : (
              <ul className="inbox">
                {tickets.data.items.map((ticket) => (
                  <InboxRow key={ticket.id} ticket={ticket} status={status.data} />
                ))}
              </ul>
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

interface Tile {
  label: string;
  value: number | undefined;
  filter: { status?: string; lane?: string };
  alert: boolean;
}

/** The counts that say what needs doing; each one is also a filter. */
function Summary({
  counts,
  status,
  current,
  show,
}: {
  counts: InquiryCountsDto | undefined;
  status: InquiryStatusDto | undefined;
  current: { status: string; lane: string };
  show: (next: { status?: string; lane?: string }) => void;
}) {
  const tiles: Tile[] = [
    { label: "未対応", value: counts?.open, filter: { status: "open" }, alert: true },
    { label: "新着", value: counts?.new, filter: { status: "NEW" }, alert: true },
    ...(status?.lanes ?? []).map((entry) => ({
      label: `${entry.label}・未対応`,
      value: counts?.openByLane[entry.key],
      filter: { status: "open", lane: entry.key },
      alert: false,
    })),
    { label: "期限超過", value: counts?.overdue, filter: { status: "open" }, alert: true },
    { label: "すべて", value: counts?.all, filter: {}, alert: false },
  ];
  return (
    <div className="inbox-stats">
      {tiles.map((tile) => (
        <button
          key={tile.label}
          type="button"
          className={`inbox-stat${tile.alert && (tile.value ?? 0) > 0 ? " inbox-stat--alert" : ""}`}
          aria-pressed={
            (tile.filter.status ?? "") === current.status &&
            (tile.filter.lane ?? "") === current.lane
          }
          onClick={() => show(tile.filter)}
        >
          <span>{tile.label}</span>
          <strong>{tile.value ?? "–"}</strong>
        </button>
      ))}
    </div>
  );
}

function InboxRow({
  ticket,
  status,
}: {
  ticket: InquiryTicketSummaryDto;
  status: InquiryStatusDto | undefined;
}) {
  const open = isOpenTicket(ticket.status);
  const due = ticket.nextActionAt !== null && open && isPast(ticket.nextActionAt);
  return (
    <li
      className={`inbox__row${ticket.status === "NEW" ? " inbox__row--new" : ""}${
        open ? "" : " inbox__row--done"
      }`}
    >
      <a href={href.inquiry(ticket.id)}>
        <span className="inbox__badges">
          <StatusBadge status={ticket.status} />
          <LaneBadge lane={ticket.lane} status={status} />
          <SlaBadge state={ticket.slaState} />
          <span className="inbox__when" title={formatDateTime(ticket.createdAt)}>
            {formatRelative(ticket.createdAt)}
          </span>
        </span>
        <strong className="inbox__subject">{ticket.subject}</strong>
        <span className="inbox__meta">
          <span className="mono">{ticket.number}</span>
          <span>{ticket.requesterEmail ?? "返信先なし"}</span>
          {ticket.updatedAt !== ticket.createdAt && (
            <span>更新 {formatRelative(ticket.updatedAt)}</span>
          )}
        </span>
        {ticket.nextAction && (
          <span className={`inbox__next${due ? " inbox__next--due" : ""}`}>
            次: {ticket.nextAction}
            {ticket.nextActionAt && `（${formatDateTime(ticket.nextActionAt)}まで）`}
          </span>
        )}
      </a>
    </li>
  );
}

/** What is missing before the screen can work, in the order it has to be done. */
function Setup({ status }: { status: InquiryStatusDto }) {
  return (
    <Panel title="共通お問い合わせ基盤への接続">
      <ol className="setup">
        <li className={status.configured ? "setup--done" : undefined}>
          API の <code>INQUIRY_OPERATOR</code> binding（基盤の <code>ProjectOperator</code>）を
          デプロイする
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
