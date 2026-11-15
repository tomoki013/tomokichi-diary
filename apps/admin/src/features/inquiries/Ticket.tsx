import { useState } from "react";
import type {
  InquiryComposeDto,
  InquiryTicketDetailDto,
  InquiryTicketStatus,
} from "@tomokichi/contracts";
import { op } from "../../data/client";
import { useAction, useOp, useTitle } from "../../data/hooks";
import { href } from "../../app/router";
import { replaceReplyOpening } from "../../lib/inquiry-compose";
import { useToast } from "../../ui/toast";
import {
  formatDateTime,
  isOpenTicket,
  isoToJstLocal,
  jstLocalToIso,
  resolutionLabels,
  ticketEventLabels,
  ticketStatusLabels,
  type Resolution,
} from "../../lib/labels";
import {
  Badge,
  Button,
  Check,
  Loaded,
  Page,
  Panel,
  Select,
  TextArea,
  TextInput,
  confirmed,
} from "../../ui/parts";

const key = () => crypto.randomUUID();

export function Ticket({ id }: { id: string }) {
  const ticket = useOp("inquiry.ticket", { ticketId: id });
  return (
    <Loaded resource={ticket} lines={8}>
      {(data) => <TicketView key={`${data.id}:${data.revision}`} ticket={data} />}
    </Loaded>
  );
}

function TicketView({ ticket }: { ticket: InquiryTicketDetailDto }) {
  useTitle(ticket.subject);
  return (
    <Page title={ticket.subject} back={{ href: href.inquiries(), label: "問い合わせ" }}>
      <div className="inline">
        <Badge tone={isOpenTicket(ticket.status) ? "warn" : "neutral"}>
          {ticketStatusLabels[ticket.status]}
        </Badge>
        <span className="muted">
          {ticket.number} · {ticket.requesterEmail} · {formatDateTime(ticket.createdAt)}
        </span>
      </div>
      <ol className="timeline">
        {ticket.timeline.map((item) =>
          item.kind === "message" ? (
            <li
              key={item.id}
              className={`message${item.direction === "outbound" ? " message--out" : item.direction === "note" ? " message--note" : ""}`}
            >
              <span className="message__meta">
                {item.direction === "note"
                  ? "メモ"
                  : item.direction === "outbound"
                    ? "返信"
                    : (item.sender ?? "受信")}{" "}
                · {formatDateTime(item.createdAt)}
              </span>
              {item.body}
            </li>
          ) : (
            <li key={item.id} className="muted">
              {ticketEventLabels[item.type] ?? item.type} · {formatDateTime(item.createdAt)}
            </li>
          ),
        )}
      </ol>
      <p>
        <a
          href={`https://admin.tmkch.io/inquiry-sharing/tomokichi-diary#${encodeURIComponent(ticket.id)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          AIへの共有を準備（別タブ）
        </a>
      </p>
      {ticket.canReply && <Reply ticket={ticket} />}
      <StatusPanel ticket={ticket} />
      <NotePanel ticket={ticket} />
    </Page>
  );
}

const touches = ["inquiry", "home"];

function Reply({ ticket }: { ticket: InquiryTicketDetailDto }) {
  const compose = useOp("inquiry.compose", { ticketId: ticket.id });
  return (
    <Loaded resource={compose}>{(data) => <ReplyForm ticket={ticket} compose={data} />}</Loaded>
  );
}

function ReplyForm({
  ticket,
  compose,
}: {
  ticket: InquiryTicketDetailDto;
  compose: InquiryComposeDto;
}) {
  const templates = useOp("inquiry.templates");
  const [identity, setIdentity] = useState<"tomokichi" | "takagi">("tomokichi");
  const [body, setBody] = useState(
    compose.openings.tomokichi ? `${compose.openings.tomokichi}\n\n` : "",
  );
  const [subject, setSubject] = useState(compose.subject);
  const [closing, setClosing] = useState(true);
  const [ccSelf, setCcSelf] = useState(readCcSelf);
  const toast = useToast();
  const [after, setAfter] = useState<"" | "WAITING_CUSTOMER" | "RESOLVED">("WAITING_CUSTOMER");
  const [idempotencyKey] = useState(key);
  const { busy, run } = useAction();
  async function applyTemplate(templateId: string) {
    const applied = await run("template", () =>
      op("inquiry.applyTemplate", { ticketId: ticket.id, templateId }),
    );
    if (!applied) return;
    setBody((current) => `${current.trimEnd()}\n\n${applied.body}`.trimStart());
    if (applied.subject && compose.subjectEditable) setSubject(applied.subject);
  }
  async function send() {
    if (!confirmed(`${compose.to ?? "相手"} に返信を送ります。送ると取り消せません。`)) return;
    const sent = await run(
      "send",
      () =>
        op("inquiry.reply", {
          ticketId: ticket.id,
          body,
          idempotencyKey,
          subject: compose.subjectEditable ? subject : null,
          afterStatus: after || null,
          closing,
          ccSelf,
        }),
      { touches },
    );
    if (!sent) return;
    toast.info(
      sent.selfCopy === "not_configured"
        ? "返信を送りました。自分のアドレスが基盤に設定されていないため、CC なしで送っています"
        : sent.selfCopy === "copied"
          ? "返信を送りました（自分にも CC）"
          : "返信を送りました",
    );
  }
  return (
    <Panel title="返信">
      <p className="muted">
        宛先 {compose.to} · 差出人 {compose.from}
      </p>
      {compose.subjectEditable ? (
        <TextInput label="件名" value={subject} onChange={setSubject} max={200} />
      ) : (
        <p className="muted">件名: {compose.subject}</p>
      )}
      <Select
        label="名乗り"
        value={identity}
        options={[
          { value: "tomokichi", label: "ともきち" },
          { value: "takagi", label: "髙木" },
        ]}
        onChange={(next) => {
          setBody((value) =>
            replaceReplyOpening(value, compose.openings[identity], compose.openings[next]),
          );
          setIdentity(next);
        }}
      />
      {templates.data && templates.data.items.some((t) => t.isActive && t.role === "reply") && (
        <Select
          label="テンプレートを足す"
          value=""
          options={[
            { value: "", label: "選ぶ…" },
            ...templates.data.items
              .filter((t) => t.isActive && t.role === "reply")
              .map((t) => ({ value: t.id, label: t.name })),
          ]}
          onChange={(value) => value && void applyTemplate(value)}
        />
      )}
      <TextArea label="本文" value={body} onChange={setBody} rows={10} />
      <Check
        label={`最後に「${compose.closing}」を付ける`}
        checked={closing}
        onChange={setClosing}
      />
      <Check
        label="自分のアドレスを CC に入れる"
        checked={ccSelf}
        onChange={(next) => {
          setCcSelf(next);
          writeCcSelf(next);
        }}
      />
      <pre className="muted" style={{ whiteSpace: "pre-wrap", margin: 0 }}>
        {compose.signature}
      </pre>
      <Select
        label="送ったあと"
        value={after}
        options={[
          { value: "WAITING_CUSTOMER", label: "返事待ちにする" },
          { value: "RESOLVED", label: "解決済みにする" },
          { value: "", label: "対応中のまま" },
        ]}
        onChange={setAfter}
      />
      <Button
        kind="primary"
        busy={busy === "send"}
        disabled={!body.trim()}
        onClick={() => void send()}
      >
        送信
      </Button>
    </Panel>
  );
}

/** The CC choice is a per-browser habit, so it is remembered here only. */
const CC_SELF_KEY = "diary-admin-reply-cc-self";
function readCcSelf(): boolean {
  try {
    return localStorage.getItem(CC_SELF_KEY) === "1";
  } catch {
    return false;
  }
}
function writeCcSelf(on: boolean): void {
  try {
    localStorage.setItem(CC_SELF_KEY, on ? "1" : "0");
  } catch {
    // Storage refused: the box simply starts unticked next time.
  }
}

function StatusPanel({ ticket }: { ticket: InquiryTicketDetailDto }) {
  const [status, setStatus] = useState<InquiryTicketStatus>(ticket.status);
  const [resolution, setResolution] = useState<Resolution>(
    (ticket.resolution as Resolution | null) ?? "RESOLVED",
  );
  const [next, setNext] = useState(ticket.nextAction ?? "");
  const [due, setDue] = useState(isoToJstLocal(ticket.nextActionAt));
  const { busy, run } = useAction();
  const statuses = [ticket.status, ...ticket.allowedStatuses.filter((s) => s !== ticket.status)];
  const closing = status === "RESOLVED" || status === "CLOSED";
  return (
    <Panel title="状態と次にやること" collapsible>
      <Select
        label="状態"
        value={status}
        options={statuses.map((s) => ({ value: s, label: ticketStatusLabels[s] }))}
        onChange={setStatus}
      />
      {closing && (
        <Select
          label="解決理由"
          value={resolution}
          options={Object.entries(resolutionLabels).map(([value, label]) => ({
            value: value as Resolution,
            label,
          }))}
          onChange={setResolution}
        />
      )}
      <TextInput label="次にやること" value={next} onChange={setNext} />
      <TextInput label="期限（日本時間）" type="datetime-local" value={due} onChange={setDue} />
      <Button
        kind="primary"
        busy={busy === "save"}
        onClick={() =>
          void run(
            "save",
            () =>
              op("inquiry.changeTicket", {
                ticketId: ticket.id,
                revision: ticket.revision,
                ...(status !== ticket.status ? { status } : {}),
                ...(closing ? { resolution } : {}),
                nextAction: next.trim() || null,
                nextActionAt: jstLocalToIso(due),
              }),
            { done: "保存しました", touches },
          )
        }
      >
        保存
      </Button>
    </Panel>
  );
}

function NotePanel({ ticket }: { ticket: InquiryTicketDetailDto }) {
  const [text, setText] = useState("");
  const { busy, run } = useAction();
  return (
    <Panel title="内部メモ" hint="相手には送られません" collapsible>
      <TextArea label="メモ" value={text} onChange={setText} rows={3} />
      <Button
        busy={busy === "note"}
        disabled={!text.trim()}
        onClick={async () => {
          const done = await run(
            "note",
            () => op("inquiry.addNote", { ticketId: ticket.id, body: text, idempotencyKey: key() }),
            {
              done: "メモを残しました",
              touches,
            },
          );
          if (done) setText("");
        }}
      >
        メモを残す
      </Button>
    </Panel>
  );
}
