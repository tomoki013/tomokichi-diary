import { useState } from "react";
import type { InquiryTicketDetailDto, InquiryTicketStatus } from "@tomokichi/contracts";
import { ApiError, api } from "../../lib/api";
import {
  formatDateTime,
  formatRelative,
  isOpenTicket,
  resolutionLabels,
  ticketEventLabels,
  ticketStatusLabels,
  type Resolution,
} from "../../lib/labels";
import { href } from "../../lib/route";
import { newIdempotencyKey, useResource, useTitle, useUnsavedWarning } from "../../ui/hooks";
import { Badge, ErrorState, PageHeader, Panel, SkeletonBlock } from "../../ui/parts";
import { useToast } from "../../ui/toast";

export function InquiryDetail({ id }: { id: string }) {
  const ticket = useResource(() => api.getTicket(id), `ticket:${id}`);

  if (ticket.error && !ticket.data) {
    return (
      <>
        <PageHeader title="お問い合わせ" meta={<a href={href.inquiries()}>← 一覧</a>} />
        <ErrorState error={ticket.error} onRetry={() => void ticket.reload()} />
      </>
    );
  }
  if (!ticket.data) {
    return (
      <>
        <PageHeader title={<span className="skeleton skeleton--title" />} />
        <div className="ticket">
          <SkeletonBlock height="24rem" />
          <SkeletonBlock height="16rem" />
        </div>
      </>
    );
  }
  return <Ticket ticket={ticket.data} reload={ticket.reload} reloading={ticket.loading} />;
}

function Ticket({
  ticket,
  reload,
  reloading,
}: {
  ticket: InquiryTicketDetailDto;
  reload: () => Promise<void>;
  reloading: boolean;
}) {
  useTitle(`${ticket.number} ${ticket.subject}`);
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  /** Runs a change; a stale revision reloads rather than overwriting someone else's. */
  const act = async (action: () => Promise<unknown>, done: string): Promise<boolean> => {
    setBusy(true);
    try {
      await action();
      toast.info(done);
      await reload();
      return true;
    } catch (error) {
      toast.error(error);
      if (error instanceof ApiError && error.status === 409) await reload();
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title={ticket.subject}
        meta={
          <>
            <a href={href.inquiries()}>← 一覧</a>
            <span className="mono">{ticket.number}</span>
            <Badge tone={isOpenTicket(ticket.status) ? "accent" : "ok"}>
              {ticketStatusLabels[ticket.status]}
            </Badge>
            {ticket.resolution && (
              <Badge>
                {resolutionLabels[ticket.resolution as Resolution] ?? ticket.resolution}
              </Badge>
            )}
            {ticket.slaState !== "OK" && (
              <Badge tone="danger">
                {ticket.slaState === "BREACHED" ? "期限超過" : "期限間近"}
              </Badge>
            )}
            <span>受付 {formatDateTime(ticket.createdAt)}</span>
          </>
        }
      />

      <div className="ticket">
        <div className="ticket__main">
          <Timeline ticket={ticket} reloading={reloading} />
          <Composer ticket={ticket} busy={busy} act={act} />
        </div>

        <aside className="ticket__side">
          <StatusPanel ticket={ticket} busy={busy} act={act} />
          <NextActionPanel ticket={ticket} busy={busy} act={act} />
          <Panel title="差出人">
            <dl className="facts">
              <dt>メール</dt>
              <dd>
                {ticket.requesterEmail ? (
                  <a href={`mailto:${ticket.requesterEmail}`}>{ticket.requesterEmail}</a>
                ) : (
                  "なし（返信不要）"
                )}
              </dd>
              <dt>優先度</dt>
              <dd>{ticket.priority}</dd>
              <dt>確認</dt>
              <dd>{formatDateTime(ticket.acknowledgedAt)}</dd>
              <dt>解決</dt>
              <dd>{formatDateTime(ticket.resolvedAt)}</dd>
            </dl>
          </Panel>
        </aside>
      </div>
    </>
  );
}

const needsResolution = (status: InquiryTicketStatus): boolean =>
  status === "RESOLVED" || status === "CLOSED";

type Act = (action: () => Promise<unknown>, done: string) => Promise<boolean>;

function Timeline({ ticket, reloading }: { ticket: InquiryTicketDetailDto; reloading: boolean }) {
  const [older, setOlder] = useState<InquiryTicketDetailDto["timeline"]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const toast = useToast();
  const items = [...ticket.timeline, ...older];
  const remaining = ticket.totalTimeline - items.length;

  async function more(): Promise<void> {
    setLoadingMore(true);
    try {
      const next = await api.getTicket(ticket.id, items.length);
      setOlder((current) => [...current, ...next.timeline]);
    } catch (error) {
      toast.error(error);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <Panel title="やりとり" className={reloading ? "is-stale" : undefined}>
      <ol className="timeline">
        {items.map((item) =>
          item.kind === "message" ? (
            <li key={item.id} className={`message message--${item.direction}`}>
              <div className="message__head">
                <strong>
                  {item.direction === "inbound"
                    ? (item.sender ?? "差出人")
                    : item.direction === "note"
                      ? "内部メモ"
                      : "返信"}
                </strong>
                <time dateTime={item.createdAt} title={formatDateTime(item.createdAt)}>
                  {formatRelative(item.createdAt)}
                </time>
              </div>
              {/* Plain text: whatever somebody typed into a form is never rendered as HTML. */}
              <div className="message__body">{item.body}</div>
            </li>
          ) : (
            <li key={item.id} className="event">
              {ticketEventLabels[item.type] ?? item.type}・{formatRelative(item.createdAt)}
            </li>
          ),
        )}
      </ol>
      {remaining > 0 && (
        <button type="button" disabled={loadingMore} onClick={() => void more()}>
          {loadingMore ? "読み込み中…" : `さらに表示（${remaining}）`}
        </button>
      )}
    </Panel>
  );
}

/**
 * Internal notes only. Readers are answered from the blog's Gmail inbox, where
 * every contact arrives with the reader as Reply-To; the platform keeps the
 * copy this screen shows and never mails a reader on this site's behalf.
 */
function Composer({
  ticket,
  busy,
  act,
}: {
  ticket: InquiryTicketDetailDto;
  busy: boolean;
  act: Act;
}) {
  const [body, setBody] = useState("");
  // One key per composed note, so a retried save never adds it twice.
  const [key, setKey] = useState(newIdempotencyKey);
  useUnsavedWarning(body.trim() !== "");

  async function save(): Promise<void> {
    const text = body.trim();
    if (text === "") return;
    if (await act(() => api.addTicketNote(ticket.id, text, key), "メモを追加しました")) {
      setBody("");
      setKey(newIdempotencyKey());
    }
  }

  return (
    <Panel title="内部メモ">
      <p className="muted small">
        返信は Gmail（tomokichidiary@gmail.com）に届いたメールから行います。
      </p>
      <textarea
        className="composer"
        rows={6}
        aria-label="メモ"
        placeholder="内部メモ（差出人には送られません）"
        value={body}
        onChange={(event) => setBody(event.target.value)}
      />
      <div className="panel__foot">
        <button
          type="button"
          className="primary"
          disabled={busy || body.trim() === ""}
          onClick={() => void save()}
        >
          メモを追加
        </button>
      </div>
    </Panel>
  );
}

function StatusPanel({
  ticket,
  busy,
  act,
}: {
  ticket: InquiryTicketDetailDto;
  busy: boolean;
  act: Act;
}) {
  const [resolution, setResolution] = useState<Resolution>(
    (ticket.resolution as Resolution | null) ?? "RESOLVED",
  );

  return (
    <Panel title="状態">
      <p>
        いま: <strong>{ticketStatusLabels[ticket.status]}</strong>
      </p>
      {ticket.allowedStatuses.some(needsResolution) && (
        <label className="field">
          <span>処理結果（解決・クローズ時）</span>
          <select
            value={resolution}
            onChange={(event) => setResolution(event.target.value as Resolution)}
          >
            {Object.entries(resolutionLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="stack">
        {ticket.allowedStatuses.map((next) => (
          <button
            key={next}
            type="button"
            className={next === "RESOLVED" ? "primary" : undefined}
            disabled={busy}
            onClick={() =>
              void act(
                () =>
                  api.changeTicket(ticket.id, {
                    revision: ticket.revision,
                    status: next,
                    ...(needsResolution(next) ? { resolution } : {}),
                  }),
                `「${ticketStatusLabels[next]}」にしました`,
              )
            }
          >
            {next === "IN_PROGRESS" && !isOpenTicket(ticket.status)
              ? "再開する"
              : `${ticketStatusLabels[next]}にする`}
          </button>
        ))}
      </div>
    </Panel>
  );
}

function NextActionPanel({
  ticket,
  busy,
  act,
}: {
  ticket: InquiryTicketDetailDto;
  busy: boolean;
  act: Act;
}) {
  const [text, setText] = useState(ticket.nextAction ?? "");
  const dirty = text.trim() !== (ticket.nextAction ?? "");

  return (
    <Panel title="次の対応">
      <textarea
        rows={2}
        aria-label="次の対応"
        placeholder="例: 写真の利用条件を確認して返信"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="panel__foot">
        {ticket.nextAction && (
          <button
            type="button"
            className="link"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await api.changeTicket(ticket.id, { revision: ticket.revision, nextAction: null });
                setText("");
              }, "次の対応を消しました")
            }
          >
            消す
          </button>
        )}
        <button
          type="button"
          disabled={busy || !dirty}
          onClick={() =>
            void act(
              () =>
                api.changeTicket(ticket.id, {
                  revision: ticket.revision,
                  nextAction: text.trim() === "" ? null : text.trim(),
                }),
              "次の対応を保存しました",
            )
          }
        >
          保存
        </button>
      </div>
    </Panel>
  );
}
