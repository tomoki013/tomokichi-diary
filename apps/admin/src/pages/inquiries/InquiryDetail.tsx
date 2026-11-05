import { replaceReplyOpening } from "../../lib/inquiry-compose";
import { useState } from "react";
import type {
  InquiryComposeDto,
  InquiryReplyTemplateDto,
  InquiryStatusDto,
  InquiryTicketDetailDto,
  InquiryTicketStatus,
  InquiryTimelineItemDto,
} from "@tomokichi/contracts";
import { ApiError, api } from "../../lib/api";
import {
  formatDateTime,
  formatRelative,
  isOpenTicket,
  isPast,
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
  const status = useResource(() => api.inquiryStatus(), "inquiry-status");

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
  return (
    <Ticket
      ticket={ticket.data}
      status={status.data}
      reload={ticket.reload}
      reloading={ticket.loading}
    />
  );
}

/** What each status asks of the operator, shown above the next steps. */
const STATUS_HINTS: Record<InquiryTicketStatus, string> = {
  NEW: "届いたばかりです。内容を読んで返信するか、対応不要なら解決にします。",
  TRIAGE: "振り分け中です。内容を確認して対応を始めます。",
  ACKNOWLEDGED: "確認済みです。返信を送ると自動で「対応中」になります。",
  IN_PROGRESS: "対応中です。返信したら「返事待ち」か「解決」にします。",
  WAITING_CUSTOMER: "相手の返事を待っています。返事が届くと自動で対応中に戻ります。",
  WAITING_INTERNAL: "こちらの確認待ちです。確認できたら対応中に戻します。",
  RESOLVED: "解決済みです。問題なければクローズします。",
  CLOSED: "クローズ済みです。必要なら再開できます。",
};

interface Step {
  key: string;
  label: string;
  to: InquiryTicketStatus;
  resolution?: Resolution;
  primary?: boolean;
}

/**
 * The next steps a ticket offers, in the order the work goes:
 * 確認 → 対応中 → 返事待ち / 解決（対応完了・対応不要・迷惑）→ クローズ.
 * Only the ones the platform allows from here are shown.
 */
function nextSteps(status: InquiryTicketStatus): Step[] {
  const resolve: Step[] = [
    {
      key: "done",
      label: "解決（対応完了）",
      to: "RESOLVED",
      resolution: "RESOLVED",
      primary: true,
    },
    {
      key: "no-action",
      label: "解決（対応不要）",
      to: "RESOLVED",
      resolution: "NO_ACTION_REQUIRED",
    },
    { key: "spam", label: "迷惑・営業として解決", to: "RESOLVED", resolution: "SPAM" },
  ];
  switch (status) {
    case "NEW":
    case "TRIAGE":
      return [
        { key: "ack", label: "確認済みにする", to: "ACKNOWLEDGED", primary: true },
        { key: "start", label: "対応を始める", to: "IN_PROGRESS" },
        ...resolve.slice(1),
      ];
    case "ACKNOWLEDGED":
      return [
        { key: "start", label: "対応を始める", to: "IN_PROGRESS", primary: true },
        ...resolve,
      ];
    case "IN_PROGRESS":
      return [
        ...resolve,
        { key: "wait", label: "返事待ちにする", to: "WAITING_CUSTOMER" },
        { key: "wait-internal", label: "こちらの確認待ちにする", to: "WAITING_INTERNAL" },
      ];
    case "WAITING_CUSTOMER":
    case "WAITING_INTERNAL":
      return [{ key: "resume", label: "対応中に戻す", to: "IN_PROGRESS" }, ...resolve];
    case "RESOLVED":
      return [
        { key: "close", label: "クローズする", to: "CLOSED", primary: true },
        { key: "reopen", label: "対応を再開する", to: "IN_PROGRESS" },
      ];
    case "CLOSED":
      return [{ key: "reopen", label: "対応を再開する", to: "IN_PROGRESS" }];
  }
}

type Act = (action: () => Promise<unknown>, done: string) => Promise<boolean>;

function Ticket({
  ticket,
  status,
  reload,
  reloading,
}: {
  ticket: InquiryTicketDetailDto;
  /** Undefined while loading: replies stay unavailable until it says mail works. */
  status: InquiryStatusDto | undefined;
  reload: () => Promise<void>;
  reloading: boolean;
}) {
  useTitle(`${ticket.number} ${ticket.subject}`);
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  /** Runs a change; a stale revision reloads rather than overwriting someone else's. */
  const act: Act = async (action, done) => {
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

  const canReply = ticket.canReply && (status?.mailConfigured ?? false);

  return (
    <>
      <PageHeader
        title={ticket.subject}
        meta={
          <>
            <a href={href.inquiries()}>← 一覧</a>
            <span className="mono">{ticket.number}</span>
            <LaneBadge lane={ticket.lane} status={status} />
            <StatusBadge status={ticket.status} />
            {ticket.resolution && (
              <Badge>
                {resolutionLabels[ticket.resolution as Resolution] ?? ticket.resolution}
              </Badge>
            )}
            <SlaBadge state={ticket.slaState} />
            <span>受付 {formatDateTime(ticket.createdAt)}</span>
          </>
        }
      />

      <div className="ticket">
        <div className="ticket__main">
          <Timeline ticket={ticket} reloading={reloading} />
          {canReply ? (
            <ReplyComposer ticket={ticket} busy={busy} act={act} />
          ) : (
            <Panel title="返信">
              <p className="muted">
                {!ticket.canReply
                  ? "返信先のメールアドレスがないため、このお問い合わせには返信できません。"
                  : status
                    ? "基盤のメール送信が未設定のため、返信できません。"
                    : "読み込み中…"}
              </p>
            </Panel>
          )}
          <NoteComposer ticket={ticket} busy={busy} act={act} />
        </div>

        <aside className="ticket__side">
          <WorkflowPanel ticket={ticket} busy={busy} act={act} />
          <NextActionPanel key={ticket.revision} ticket={ticket} busy={busy} act={act} />
          <Panel title="お問い合わせの情報">
            <dl className="facts">
              <dt>差出人</dt>
              <dd>
                {ticket.requesterEmail ? (
                  <a href={`mailto:${ticket.requesterEmail}`}>{ticket.requesterEmail}</a>
                ) : (
                  "なし（返信不要）"
                )}
              </dd>
              <dt>種類</dt>
              <dd>{ticket.subject}</dd>
              <dt>番号</dt>
              <dd className="mono">{ticket.number}</dd>
              {ticket.receiptId && (
                <>
                  <dt>受付ID</dt>
                  <dd className="mono small">{ticket.receiptId}</dd>
                </>
              )}
              <dt>優先度</dt>
              <dd>{ticket.priority}</dd>
              <dt>確認</dt>
              <dd>{formatDateTime(ticket.acknowledgedAt)}</dd>
              <dt>解決</dt>
              <dd>{formatDateTime(ticket.resolvedAt)}</dd>
              <dt>更新</dt>
              <dd>{formatDateTime(ticket.updatedAt)}</dd>
            </dl>
          </Panel>
        </aside>
      </div>
    </>
  );
}

/** The lane (動線) a ticket's topic belongs to, as the API names it. */
export function LaneBadge({
  lane,
  status,
}: {
  lane: string | null;
  status: InquiryStatusDto | undefined;
}) {
  if (lane === null) return null;
  const label = status?.lanes.find((entry) => entry.key === lane)?.label ?? lane;
  return <Badge tone={lane === "media" ? "warn" : "neutral"}>{label}</Badge>;
}

export function StatusBadge({ status }: { status: InquiryTicketStatus }) {
  const tone =
    status === "NEW"
      ? "accent"
      : status === "RESOLVED" || status === "CLOSED"
        ? "ok"
        : status === "WAITING_CUSTOMER"
          ? "neutral"
          : "warn";
  return <Badge tone={tone}>{ticketStatusLabels[status]}</Badge>;
}

export function SlaBadge({ state }: { state: "OK" | "AT_RISK" | "BREACHED" }) {
  if (state === "OK") return null;
  return <Badge tone="danger">{state === "BREACHED" ? "期限超過" : "期限間近"}</Badge>;
}

/**
 * A mail reply carries the earlier conversation quoted under it. Split it off
 * so what the person wrote this time reads as the message.
 */
function splitQuoted(body: string): { own: string; quoted: string | null } {
  const lines = body.split("\n");
  const header =
    /^(On .+ wrote:|.*\d{4}[年/]\d{1,2}[月/]\d{1,2}.*(書きました|wrote)[:：]?|-{2,}\s*(Original Message|元のメッセージ)\s*-{2,}|From:\s.+|差出人[:：].+)\s*$/i;
  let at = lines.findIndex((line) => header.test(line.trim()));
  if (at === -1) at = lines.findIndex((line) => line.startsWith(">"));
  if (at <= 0) return { own: body, quoted: null };
  return { own: lines.slice(0, at).join("\n").trimEnd(), quoted: lines.slice(at).join("\n") };
}

type Message = Extract<InquiryTimelineItemDto, { kind: "message" }>;

function messageTitle(item: Message, firstInbound: string | undefined): string {
  if (item.direction === "note") return "内部メモ";
  if (item.direction === "outbound") return "こちらからの返信";
  return item.id === firstInbound ? "お問い合わせ" : "相手からの返信";
}

function Timeline({ ticket, reloading }: { ticket: InquiryTicketDetailDto; reloading: boolean }) {
  const [older, setOlder] = useState<InquiryTicketDetailDto["timeline"]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const toast = useToast();
  const items = [...ticket.timeline, ...older];
  const remaining = ticket.totalTimeline - items.length;
  const inbound = items.filter(
    (item): item is Message => item.kind === "message" && item.direction === "inbound",
  );
  const firstInbound = inbound.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))[0]?.id;

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
        {items.map((item) => {
          if (item.kind === "event") {
            return (
              <li key={item.id} className="event">
                {ticketEventLabels[item.type] ?? item.type}・{formatRelative(item.createdAt)}
              </li>
            );
          }
          const { own, quoted } =
            item.direction === "inbound"
              ? splitQuoted(item.body)
              : { own: item.body, quoted: null };
          return (
            <li key={item.id} className={`message message--${item.direction}`}>
              <div className="message__head">
                <strong>{messageTitle(item, firstInbound)}</strong>
                <time dateTime={item.createdAt} title={formatDateTime(item.createdAt)}>
                  {item.sender && item.direction === "inbound" ? `${item.sender}・` : ""}
                  {formatRelative(item.createdAt)}
                </time>
              </div>
              {/* Plain text: whatever somebody typed into a form is never rendered as HTML. */}
              <div className="message__body">{own}</div>
              {quoted && (
                <details className="message__quoted">
                  <summary>以前のやりとり（引用）</summary>
                  <div className="message__body">{quoted}</div>
                </details>
              )}
            </li>
          );
        })}
      </ol>
      {remaining > 0 && (
        <button type="button" disabled={loadingMore} onClick={() => void more()}>
          {loadingMore ? "読み込み中…" : `さらに表示（${remaining}）`}
        </button>
      )}
    </Panel>
  );
}

/** Templates grouped by what their name says before `：` (記事, 取材・お仕事, …). */
function groupTemplates(templates: readonly InquiryReplyTemplateDto[]) {
  const groups = new Map<string, InquiryReplyTemplateDto[]>();
  for (const template of templates) {
    const [group, ...rest] = template.name.split("：");
    const key = rest.length > 0 && group ? group : "その他";
    groups.set(key, [...(groups.get(key) ?? []), template]);
  }
  return [...groups];
}

const shortName = (name: string): string => name.split("：").slice(1).join("：") || name;

type After = "" | "WAITING_CUSTOMER" | "RESOLVED";

/**
 * Loads what a reply to this ticket starts from, then hands it to the form.
 * Reloaded after a send, since the first reply fixes the subject.
 */
function ReplyComposer({
  ticket,
  busy,
  act,
}: {
  ticket: InquiryTicketDetailDto;
  busy: boolean;
  act: Act;
}) {
  const compose = useResource(() => api.getCompose(ticket.id), `compose:${ticket.id}`);
  const templates = useResource(() => api.listReplyTemplates(), "reply-templates");

  if (compose.error) {
    return (
      <Panel title="返信を書く">
        <ErrorState error={compose.error} onRetry={() => void compose.reload()} />
      </Panel>
    );
  }
  if (!compose.data) {
    return (
      <Panel title="返信を書く">
        <SkeletonBlock height="18rem" />
      </Panel>
    );
  }
  const pickable =
    templates.data?.items.filter((template) => template.role === "reply" && template.isActive) ??
    [];
  return (
    <MailForm
      key={`${compose.data.subjectEditable}:${compose.data.subject}`}
      ticket={ticket}
      compose={compose.data}
      templates={pickable}
      busy={busy}
      act={act}
      onSent={() => void compose.reload()}
    />
  );
}

/**
 * A reply laid out as the mail it becomes: who it goes to and from, the
 * subject (filled in, and editable while it can still be chosen), the body
 * starting from the greeting, and what the platform adds under it. Sending
 * goes through a preview of the whole mail.
 */
function MailForm({
  ticket,
  compose,
  templates,
  busy,
  act,
  onSent,
}: {
  ticket: InquiryTicketDetailDto;
  compose: InquiryComposeDto;
  templates: readonly InquiryReplyTemplateDto[];
  busy: boolean;
  act: Act;
  onSent: () => void;
}) {
  const toast = useToast();
  const [identity, setIdentity] = useState<"takagi" | "tomokichi">("tomokichi");
  const opening = compose.openings[identity];
  const start = opening ? `${opening}\n\n` : "";
  const [subject, setSubject] = useState(compose.subject);
  const [body, setBody] = useState(start);
  const [after, setAfter] = useState<After>("WAITING_CUSTOMER");
  const [closing, setClosing] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  // One key per composed message, so a retried send never mails twice.
  const [key, setKey] = useState(newIdempotencyKey);
  const written = body.trim() !== "" && body.trim() !== start.trim();
  useUnsavedWarning(written);

  const typed = compose.subjectEditable ? `${subject}\n${body}` : body;
  const left = [...new Set([...typed.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((m) => m[1]))];
  const closed = !isOpenTicket(ticket.status);
  const ready = written && left.length === 0 && (!compose.subjectEditable || subject.trim() !== "");

  async function insert(templateId: string): Promise<void> {
    if (templateId === "") return;
    if (written && !globalThis.confirm("書きかけの本文をテンプレートで置き換えますか？")) return;
    try {
      const applied = await api.applyTemplate(ticket.id, templateId);
      setBody(`${start}${applied.body.trim()}\n`);
      if (compose.subjectEditable && applied.subject) setSubject(applied.subject);
      setPreviewing(false);
    } catch (error) {
      toast.error(error);
    }
  }

  async function send(): Promise<void> {
    const sent = await act(
      () =>
        api.replyToTicket(ticket.id, {
          body: body.trim(),
          idempotencyKey: key,
          subject: compose.subjectEditable ? subject.trim() : null,
          afterStatus: after === "" ? null : after,
          closing,
        }),
      after === "RESOLVED"
        ? "返信を送り、解決済みにしました"
        : after === "WAITING_CUSTOMER"
          ? "返信を送り、返事待ちにしました"
          : "返信を送りました",
    );
    if (sent) {
      setBody(start);
      setPreviewing(false);
      setKey(newIdempotencyKey());
      onSent();
    }
  }

  const footer = [closing ? compose.closing : "", compose.signature]
    .filter((part) => part.trim())
    .join("\n\n");

  return (
    <Panel
      title={previewing ? "送信内容の確認" : "返信を書く"}
      actions={
        templates.length > 0 && !previewing ? (
          <select
            aria-label="テンプレートを使う"
            value=""
            disabled={busy}
            onChange={(event) => void insert(event.target.value)}
          >
            <option value="">テンプレートを使う…</option>
            {groupTemplates(templates).map(([group, items]) => (
              <optgroup key={group} label={group}>
                {items.map((template) => (
                  <option key={template.id} value={template.id}>
                    {shortName(template.name)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        ) : undefined
      }
    >
      <div className={`mail${previewing ? " mail--preview" : ""}`}>
        <dl className="mail__head">
          <dt>宛先</dt>
          <dd>{compose.to}</dd>
          <dt>差出人</dt>
          <dd>{compose.from}</dd>
          <dt>件名</dt>
          <dd>
            {compose.subjectEditable && !previewing ? (
              <input
                aria-label="件名"
                maxLength={200}
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
              />
            ) : (
              <>
                <strong>{compose.subjectEditable ? subject : compose.subject}</strong>
                {!compose.subjectEditable && (
                  <span className="mail__note">最初の返信と同じ会話として届きます</span>
                )}
              </>
            )}
          </dd>
        </dl>

        {previewing ? (
          <div className="mail__text">
            {body.trim()}
            {footer && <span className="mail__added">{`\n\n${footer}`}</span>}
          </div>
        ) : (
          <>
            <label className="field">
              <span>名乗り</span>
              <select
                aria-label="名乗り"
                value={identity}
                disabled={busy}
                onChange={(event) => {
                  const next = event.target.value as "takagi" | "tomokichi";
                  setBody((value) => replaceReplyOpening(value, opening, compose.openings[next]));
                  setIdentity(next);
                }}
              >
                <option value="takagi">ともきちの旅行日記を運営しております、髙木です。</option>
                <option value="tomokichi">
                  ともきちの旅行日記を運営しております、ともきちです。
                </option>
              </select>
            </label>
            <textarea
              className="mail__text"
              rows={14}
              aria-label="本文"
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
            <label className="check mail__closing">
              <input
                type="checkbox"
                checked={closing}
                onChange={(event) => setClosing(event.target.checked)}
              />
              最後に「{compose.closing}」を付ける
            </label>
            {footer && (
              <div className="mail__added mail__added--below">
                <span className="mail__note">送信時に自動で付きます</span>
                {footer}
              </div>
            )}
          </>
        )}
      </div>

      {left.length > 0 && (
        <p className="form-error" role="alert">
          {left.map((name) => `{{${name}}}`).join("、")}{" "}
          を書き換えてください（件名も含みます）。残っている間は送信できません。
        </p>
      )}

      <div className="mail__foot">
        <label className="mail__after">
          <span>送ったあと</span>
          <select value={after} onChange={(event) => setAfter(event.target.value as After)}>
            <option value="WAITING_CUSTOMER">返事待ちにする</option>
            <option value="RESOLVED">解決済みにする</option>
            <option value="">対応中のままにする</option>
          </select>
        </label>
        {closed && <span className="muted small">解決済みです。送ると対応中に戻ります。</span>}
        <div className="mail__actions">
          {previewing ? (
            <>
              <button type="button" disabled={busy} onClick={() => setPreviewing(false)}>
                戻って直す
              </button>
              <button type="button" className="primary" disabled={busy} onClick={() => void send()}>
                {busy ? "送信中…" : "この内容で送信"}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="primary"
              disabled={busy || !ready}
              onClick={() => setPreviewing(true)}
            >
              送信内容を確認
            </button>
          )}
        </div>
      </div>
    </Panel>
  );
}

function NoteComposer({
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
      <textarea
        rows={3}
        aria-label="メモ"
        placeholder="自分用のメモ（相手には送られません）例: 写真の利用条件を確認中"
        value={body}
        onChange={(event) => setBody(event.target.value)}
      />
      <div className="panel__foot">
        <button type="button" disabled={busy || body.trim() === ""} onClick={() => void save()}>
          メモを追加
        </button>
      </div>
    </Panel>
  );
}

function WorkflowPanel({
  ticket,
  busy,
  act,
}: {
  ticket: InquiryTicketDetailDto;
  busy: boolean;
  act: Act;
}) {
  const steps = nextSteps(ticket.status).filter((step) => ticket.allowedStatuses.includes(step.to));

  return (
    <Panel title="進め方">
      <p className="workflow__now">
        <StatusBadge status={ticket.status} />
        {ticket.resolution && (
          <span className="muted small">
            {resolutionLabels[ticket.resolution as Resolution] ?? ticket.resolution}
          </span>
        )}
      </p>
      <p className="muted small">{STATUS_HINTS[ticket.status]}</p>
      <div className="stack">
        {steps.map((step) => (
          <button
            key={step.key}
            type="button"
            className={step.primary ? "primary" : undefined}
            disabled={busy}
            onClick={() =>
              void act(
                () =>
                  api.changeTicket(ticket.id, {
                    revision: ticket.revision,
                    status: step.to,
                    ...(step.resolution
                      ? { resolution: step.resolution }
                      : step.to === "CLOSED" && !ticket.resolution
                        ? { resolution: "RESOLVED" as const }
                        : {}),
                  }),
                `「${step.label}」にしました`,
              )
            }
          >
            {step.label}
          </button>
        ))}
      </div>
    </Panel>
  );
}

/** `datetime-local` speaks local time without a zone; the API speaks ISO. */
const toLocalInput = (iso: string | null): string => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

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
  const [due, setDue] = useState(toLocalInput(ticket.nextActionAt));
  const dirty =
    text.trim() !== (ticket.nextAction ?? "") || due !== toLocalInput(ticket.nextActionAt);
  const overdue =
    ticket.nextActionAt !== null && isPast(ticket.nextActionAt) && isOpenTicket(ticket.status);

  return (
    <Panel title="次にやること">
      <textarea
        rows={2}
        aria-label="次にやること"
        placeholder="例: 写真の利用条件を確認して返信"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <label className="field">
        <span>
          期限
          {overdue && <em className="field__hint form-error">期限を過ぎています</em>}
        </span>
        <input type="datetime-local" value={due} onChange={(event) => setDue(event.target.value)} />
      </label>
      <div className="panel__foot">
        {(ticket.nextAction || ticket.nextActionAt) && (
          <button
            type="button"
            className="link"
            disabled={busy}
            onClick={() =>
              void act(
                () =>
                  api.changeTicket(ticket.id, {
                    revision: ticket.revision,
                    nextAction: null,
                    nextActionAt: null,
                  }),
                "次にやることを消しました",
              )
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
                  nextActionAt: due === "" ? null : new Date(due).toISOString(),
                }),
              "次にやることを保存しました",
            )
          }
        >
          保存
        </button>
      </div>
    </Panel>
  );
}
