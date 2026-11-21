import { useId, useState } from "react";
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
import { AddressField, HeaderRow, sameAddresses } from "./MailHeader";
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
  const title = ticket.mailSubject ?? ticket.subject;
  useTitle(title);
  return (
    <Page title={title} back={{ href: href.inquiries(), label: "問い合わせ" }}>
      <div className="inline">
        <Badge tone={isOpenTicket(ticket.status) ? "warn" : "neutral"}>
          {ticketStatusLabels[ticket.status]}
        </Badge>
        <span className="muted">
          {ticket.mailSubject && ticket.mailSubject !== ticket.subject && `${ticket.subject} · `}
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
              {item.direction !== "note" && (
                <Recipients recipient={item.recipient} subject={item.subject} />
              )}
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
  const [to, setTo] = useState<string[]>([...compose.to]);
  const [cc, setCc] = useState<string[]>([...compose.cc]);
  const editable = compose.overridesAllowed;
  const [closing, setClosing] = useState(true);
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
    if (applied.subject) setSubject(applied.subject);
  }
  async function send() {
    if (to.length === 0) {
      toast.error(new Error("宛先がありません"));
      return;
    }
    const lines = [
      `宛先: ${to.join(", ")}`,
      ...(cc.length > 0 ? [`CC: ${cc.join(", ")}`] : []),
      `件名: ${subject.trim()}`,
    ];
    if (!confirmed(`この内容で返信を送ります。送ると取り消せません。\n\n${lines.join("\n")}`))
      return;
    const subjectChanged = subject.trim() !== compose.subject;
    const sent = await run(
      "send",
      () =>
        op("inquiry.reply", {
          ticketId: ticket.id,
          body,
          idempotencyKey,
          subject: compose.subjectSetsThread || subjectChanged ? subject.trim() : null,
          to: sameAddresses(to, compose.to) ? null : to,
          cc: sameAddresses(cc, compose.cc) ? null : cc,
          afterStatus: after || null,
          closing,
        }),
      { touches },
    );
    if (!sent) return;
    toast.info("返信を送りました");
  }
  return (
    <Panel title="返信">
      <div className="mail-header">
        <HeaderRow label="差出人">
          <span>{compose.from}</span>
        </HeaderRow>
        <AddressField label="宛先" value={to} onChange={setTo} max={5} readOnly={!editable} />
        <AddressField label="CC" value={cc} onChange={setCc} max={10} readOnly={!editable} />
        <SubjectRow
          value={subject}
          onChange={setSubject}
          readOnly={!editable && !compose.subjectSetsThread}
        />
        {compose.subjectSetsThread ? (
          <p className="field__hint">最初の返信の件名は、このあとのやり取りの件名になります。</p>
        ) : (
          subject.trim() !== compose.subject && (
            <p className="field__hint">
              変えた件名は書いたとおりに送られ、このあとのやり取りの件名になります。受付番号が無ければ末尾に付きます。
            </p>
          )
        )}
        {editable && (!sameAddresses(to, compose.to) || !sameAddresses(cc, compose.cc)) && (
          <Button
            kind="quiet"
            onClick={() => {
              setTo([...compose.to]);
              setCc([...compose.cc]);
            }}
          >
            宛先と CC を元に戻す
          </Button>
        )}
      </div>
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
        disabled={!body.trim() || to.length === 0 || !subject.trim()}
        onClick={() => void send()}
      >
        送信
      </Button>
    </Panel>
  );
}

/** A mail's header as received or sent: who it went to (the person, then every Cc) and its subject. */
function Recipients({ recipient, subject }: { recipient: string | null; subject: string | null }) {
  const [first, ...copies] = (recipient ?? "")
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);
  if (!first && !subject) return null;
  return (
    <span className="message__meta">
      {first && (
        <span className="message__header">
          宛先 {first}
          {copies.length > 0 && <> · CC {copies.join(", ")}</>}
        </span>
      )}
      {subject && <span className="message__header">件名 {subject}</span>}
    </span>
  );
}

function SubjectRow({
  value,
  onChange,
  readOnly,
}: {
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
}) {
  const id = useId();
  return (
    <HeaderRow label="件名" htmlFor={readOnly ? undefined : id}>
      {readOnly ? (
        <span>{value}</span>
      ) : (
        <input
          id={id}
          type="text"
          value={value}
          maxLength={200}
          onChange={(event) => onChange(event.target.value.replace(/[\r\n]+/g, " "))}
        />
      )}
    </HeaderRow>
  );
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
