import { useState } from "react";
import { api, type LegacyMessageDto } from "../../lib/api";
import { formatDateTime } from "../../lib/labels";
import { href } from "../../lib/route";
import { useResource, useTitle } from "../../ui/hooks";
import { Badge, EmptyState, ErrorState, PageHeader, Panel, SkeletonRows } from "../../ui/parts";
import { useToast } from "../../ui/toast";

const statusLabels: Record<LegacyMessageDto["status"], string> = {
  unread: "未読",
  read: "既読",
  spam: "スパム",
};

/**
 * Messages that arrived before the contact form moved to the inquiry platform.
 * Nothing new lands here; it stays readable so nothing is lost.
 */
export function LegacyMessages() {
  useTitle("切替前の受信箱");
  const toast = useToast();
  const messages = useResource(() => api.listLegacyMessages(), "legacy-messages");
  const [open, setOpen] = useState<string | null>(null);
  const [showSpam, setShowSpam] = useState(false);

  async function setStatus(id: string, status: LegacyMessageDto["status"]): Promise<void> {
    try {
      await api.setLegacyMessageStatus(id, status);
      messages.setData(
        (current) =>
          current && {
            ...current,
            items: current.items.map((item) => (item.id === id ? { ...item, status } : item)),
          },
      );
    } catch (error) {
      toast.error(error);
    }
  }

  const items = (messages.data?.items ?? []).filter((item) => showSpam || item.status !== "spam");

  return (
    <>
      <PageHeader
        title="切替前の受信箱"
        meta={
          <>
            <a href={href.inquiries()}>← お問い合わせ</a>
            <span>
              共通お問い合わせ基盤に移る前に届いたメッセージです。新しいものは届きません。
            </span>
          </>
        }
        actions={
          <label className="check">
            <input
              type="checkbox"
              checked={showSpam}
              onChange={(event) => setShowSpam(event.target.checked)}
            />
            スパムも表示
          </label>
        }
      />
      <Panel className="panel--flush">
        {messages.error ? (
          <ErrorState error={messages.error} onRetry={() => void messages.reload()} />
        ) : !messages.data ? (
          <SkeletonRows rows={6} />
        ) : items.length === 0 ? (
          <EmptyState>メッセージはありません。</EmptyState>
        ) : (
          <ul className="legacy">
            {items.map((message) => (
              <li
                key={message.id}
                className={message.status === "unread" ? "row--unread" : undefined}
              >
                <button
                  type="button"
                  className="legacy__head"
                  aria-expanded={open === message.id}
                  onClick={() => {
                    setOpen(open === message.id ? null : message.id);
                    if (message.status === "unread") void setStatus(message.id, "read");
                  }}
                >
                  <span className="legacy__subject">{message.subject}</span>
                  <span className="muted">{message.name}</span>
                  <Badge
                    tone={
                      message.status === "unread"
                        ? "accent"
                        : message.status === "spam"
                          ? "danger"
                          : "neutral"
                    }
                  >
                    {statusLabels[message.status]}
                  </Badge>
                  <span className="muted nowrap">{formatDateTime(message.createdAt)}</span>
                </button>
                {open === message.id && (
                  <div className="legacy__body">
                    <p>
                      <a
                        href={`mailto:${message.email}?subject=${encodeURIComponent(`Re: ${message.subject}`)}`}
                      >
                        {message.email}
                      </a>
                    </p>
                    <div className="message__body">{message.body}</div>
                    <div className="row">
                      {message.status !== "spam" ? (
                        <button
                          type="button"
                          className="danger"
                          onClick={() => void setStatus(message.id, "spam")}
                        >
                          スパムにする
                        </button>
                      ) : (
                        <button type="button" onClick={() => void setStatus(message.id, "read")}>
                          スパムではない
                        </button>
                      )}
                      {message.status === "read" && (
                        <button type="button" onClick={() => void setStatus(message.id, "unread")}>
                          未読に戻す
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
