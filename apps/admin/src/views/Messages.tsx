import { useCallback, useEffect, useState } from "react";
import { api, type ContactMessageDto } from "../api";
import type { ToastMessage } from "../components/Toast";

/**
 * Contact submissions are stored rather than emailed, so this is where they
 * are read. Anything the spam heuristic flagged is still shown — a false
 * positive must not disappear silently.
 */
export function Messages({
  notify,
  onError,
}: {
  notify: (message: ToastMessage) => void;
  onError: (error: unknown) => void;
}) {
  const [items, setItems] = useState<ContactMessageDto[] | null>(null);
  const [showSpam, setShowSpam] = useState(false);

  const load = useCallback(() => {
    api.listMessages().then((response) => setItems(response.items), onError);
  }, [onError]);

  useEffect(load, [load]);

  async function setStatus(id: string, status: ContactMessageDto["status"]): Promise<void> {
    try {
      await api.setMessageStatus(id, status);
      setItems((current) =>
        (current ?? []).map((item) => (item.id === id ? { ...item, status } : item)),
      );
      notify({ tone: "info", text: "状態を更新しました" });
    } catch (error) {
      onError(error);
    }
  }

  if (items === null) return <p className="muted">読み込み中…</p>;

  const visible = items.filter((item) => showSpam || item.status !== "spam");
  const unread = items.filter((item) => item.status === "unread").length;
  const spam = items.length - items.filter((item) => item.status !== "spam").length;

  return (
    <div className="panel">
      <h2>
        お問い合わせ（未読 {unread} / 全 {items.length}）
      </h2>
      <div className="row" style={{ marginBottom: "1rem" }}>
        <label style={{ margin: 0, display: "inline-flex", gap: "0.35rem", alignItems: "center" }}>
          <input
            type="checkbox"
            checked={showSpam}
            style={{ width: "auto" }}
            onChange={(event) => setShowSpam(event.target.checked)}
          />
          <span style={{ margin: 0 }}>スパム判定を表示（{spam}）</span>
        </label>
        <button onClick={load}>再読み込み</button>
      </div>

      {visible.length === 0 ? (
        <p className="muted">お問い合わせはまだありません。</p>
      ) : (
        visible.map((item) => (
          <article
            key={item.id}
            style={{
              borderTop: "1px solid var(--border)",
              paddingTop: "0.9rem",
              marginTop: "0.9rem",
              opacity: item.status === "read" ? 0.65 : 1,
            }}
          >
            <div className="row">
              <strong>{item.subject}</strong>
              {item.status === "unread" && <span className="badge dirty">未読</span>}
              {item.status === "spam" && <span className="badge">スパム</span>}
              <span style={{ flex: 1 }} />
              <span className="muted">{item.createdAt.slice(0, 16).replace("T", " ")}</span>
            </div>
            <p className="muted" style={{ margin: "0.2rem 0" }}>
              {item.name} &lt;
              <a href={`mailto:${item.email}?subject=Re: ${encodeURIComponent(item.subject)}`}>
                {item.email}
              </a>
              &gt;
            </p>
            <p style={{ whiteSpace: "pre-wrap", margin: "0.5rem 0" }}>{item.body}</p>
            <div className="row">
              {item.status !== "read" && (
                <button onClick={() => void setStatus(item.id, "read")}>既読にする</button>
              )}
              {item.status !== "unread" && (
                <button onClick={() => void setStatus(item.id, "unread")}>未読に戻す</button>
              )}
              {item.status !== "spam" && (
                <button className="danger" onClick={() => void setStatus(item.id, "spam")}>
                  スパム
                </button>
              )}
            </div>
          </article>
        ))
      )}
    </div>
  );
}
