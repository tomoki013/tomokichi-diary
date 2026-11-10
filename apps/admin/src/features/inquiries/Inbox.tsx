import { useState } from "react";
import { useOp, useTitle } from "../../data/hooks";
import { href } from "../../app/router";
import { formatRelative, isOpenTicket, ticketStatusLabels } from "../../lib/labels";
import {
  Badge,
  Button,
  Empty,
  LinkButton,
  Loaded,
  Page,
  Row,
  Rows,
  Tabs,
  TextInput,
} from "../../ui/parts";

/** Readers' messages from the contact form, worked on the shared inquiry platform. */
export function Inbox() {
  useTitle("問い合わせ");
  const status = useOp("inquiry.status");
  const [filter, setFilter] = useState<"open" | "">("open");
  const [lane, setLane] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const tickets = useOp("inquiry.tickets", { status: filter, lane, query, offset });
  if (status.data && !status.data.configured)
    return (
      <Page title="問い合わせ" back={{ href: href.more(), label: "その他" }}>
        <Empty>共通問い合わせ基盤への接続が未設定です。</Empty>
      </Page>
    );
  return (
    <Page
      title="問い合わせ"
      back={{ href: href.more(), label: "その他" }}
      actions={<LinkButton href={href.inquirySettings()}>返信の設定</LinkButton>}
    >
      {status.data && !status.data.mailConfigured && (
        <p className="error-box">返信メールの送信が未設定です。</p>
      )}
      <Tabs
        value={filter}
        onChange={(value) => {
          setFilter(value);
          setOffset(0);
        }}
        options={[
          { value: "open", label: "未対応", count: tickets.data?.counts.open },
          { value: "", label: "すべて", count: tickets.data?.counts.all },
        ]}
      />
      {status.data && (
        <Tabs
          value={lane}
          onChange={(value) => {
            setLane(value);
            setOffset(0);
          }}
          options={[
            { value: "", label: "全部" },
            ...status.data.lanes.map((l) => ({
              value: l.key,
              label: l.label,
              count: tickets.data?.counts.openByLane[l.key],
            })),
          ]}
        />
      )}
      <TextInput label="検索" type="search" value={query} onChange={setQuery} />
      <Loaded resource={tickets} lines={6}>
        {(data) =>
          data.items.length === 0 ? (
            <Empty>問い合わせはありません。</Empty>
          ) : (
            <>
              <Rows>
                {data.items.map((ticket) => (
                  <Row
                    key={ticket.id}
                    href={href.inquiry(ticket.id)}
                    title={ticket.subject}
                    meta={`${ticket.number} · ${ticket.requesterEmail ?? ""} · ${formatRelative(ticket.createdAt)}`}
                    aside={
                      <Badge
                        tone={
                          ticket.slaState === "BREACHED"
                            ? "danger"
                            : isOpenTicket(ticket.status)
                              ? "warn"
                              : "neutral"
                        }
                      >
                        {ticketStatusLabels[ticket.status]}
                      </Badge>
                    }
                  />
                ))}
              </Rows>
              {data.hasMore && <Button onClick={() => setOffset(offset + data.limit)}>次へ</Button>}
            </>
          )
        }
      </Loaded>
    </Page>
  );
}
