import { useState, type FormEvent } from "react";
import { api, type ActivityEventDto, type ActivityFilters } from "../lib/api";
import { href } from "../lib/route";
import { useResource } from "../ui/hooks";
import { ErrorState, PageHeader, Panel } from "../ui/parts";

const resultLabel: Record<ActivityEventDto["result"], string> = {
  requested: "受付中",
  succeeded: "成功",
  failed: "失敗",
  rejected: "拒否",
};

function clientLabel(event: ActivityEventDto): string {
  if (!event.clientName) return "不明なクライアント";
  return event.clientTrust === "confirmed" ? event.clientName : `${event.clientName}（自己申告）`;
}

function targetLabel(event: ActivityEventDto): string {
  const type = event.targetType ?? "対象不明";
  return event.targetId ? `${type} · ${event.targetId}` : type;
}

function actionLabel(event: ActivityEventDto): string {
  if (event.mcpToolName) return `MCPツール: ${event.mcpToolName}`;
  return event.action.replaceAll(".", " · ").replaceAll("_", " ");
}

export function Activity({ targetType, targetId }: { targetType?: string; targetId?: string }) {
  const [filters, setFilters] = useState<ActivityFilters>(() => ({
    ...(targetType ? { targetType } : {}),
    ...(targetId ? { targetId } : {}),
    limit: 50,
  }));
  const [draft, setDraft] = useState<ActivityFilters>(filters);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const query = { ...filters, page, limit: 50 };
  const activity = useResource(() => api.activity(query), `activity:${JSON.stringify(query)}`);
  const events = activity.data?.items ?? [];
  const pages = activity.data?.pages ?? 0;
  const total = activity.data?.total ?? 0;

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFilters({ ...draft, limit: 50 });
    setPage(1);
  };

  return (
    <>
      <PageHeader
        title="操作履歴"
        meta={
          <span>
            管理APIとリモートMCPの操作をD1から検索します。クライアント名は確認済み表示がない限り自己申告として扱います。
          </span>
        }
      />
      <Panel title="絞り込み">
        <form className="activity-filters" onSubmit={applyFilters}>
          <label className="field">
            <span>開始日</span>
            <input
              type="date"
              value={draft.start ?? ""}
              onChange={(e) => setDraft({ ...draft, start: e.target.value })}
            />
          </label>
          <label className="field">
            <span>終了日</span>
            <input
              type="date"
              value={draft.end ?? ""}
              onChange={(e) => setDraft({ ...draft, end: e.target.value })}
            />
          </label>
          <label className="field">
            <span>クライアント</span>
            <input
              value={draft.client ?? ""}
              placeholder="名前または unknown"
              onChange={(e) => setDraft({ ...draft, client: e.target.value })}
            />
          </label>
          <label className="field">
            <span>操作</span>
            <input
              value={draft.action ?? ""}
              placeholder="例: put.articles"
              onChange={(e) => setDraft({ ...draft, action: e.target.value })}
            />
          </label>
          <label className="field">
            <span>対象</span>
            <select
              value={draft.targetType ?? ""}
              onChange={(e) => setDraft({ ...draft, targetType: e.target.value || undefined })}
            >
              <option value="">すべて</option>
              <option value="article">記事</option>
              <option value="note">一言日記</option>
              <option value="series">シリーズ</option>
              <option value="tag">タグ</option>
              <option value="ranking">ランキング</option>
              <option value="ad">広告・収益化</option>
              <option value="publication">サイト公開</option>
              <option value="media">画像</option>
              <option value="connection">MCP接続</option>
            </select>
          </label>
          <label className="field">
            <span>結果</span>
            <select
              value={draft.result ?? ""}
              onChange={(e) => setDraft({ ...draft, result: e.target.value || undefined })}
            >
              <option value="">すべて</option>
              <option value="succeeded">成功</option>
              <option value="failed">失敗</option>
              <option value="rejected">拒否</option>
              <option value="requested">受付中</option>
            </select>
          </label>
          <button className="primary" type="submit">
            検索
          </button>
          <button
            type="button"
            onClick={() => {
              const next = { limit: 50 };
              setDraft(next);
              setFilters(next);
              setPage(1);
            }}
          >
            クリア
          </button>
        </form>
      </Panel>
      <Panel
        title={`履歴 ${total.toLocaleString("ja-JP")}件`}
        actions={
          pages > 1 ? (
            <span className="muted">
              {page} / {pages} ページ
            </span>
          ) : undefined
        }
      >
        {activity.error ? (
          <ErrorState error={activity.error} onRetry={() => void activity.reload()} />
        ) : activity.loading ? (
          <p className="state">読み込み中…</p>
        ) : events.length === 0 ? (
          <p className="state">該当する履歴はありません。</p>
        ) : (
          <div className="activity-list">
            {events.map((event) => (
              <article className="activity-event" key={event.id}>
                <div className="activity-event__main">
                  <time dateTime={event.occurredAt}>
                    {new Date(event.occurredAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
                  </time>
                  <strong>{clientLabel(event)}</strong>
                  <span>
                    {event.actorType}
                    {event.actorSubject ? ` · ${event.actorSubject}` : ""}
                  </span>
                  <span>{actionLabel(event)}</span>
                  <span>{targetLabel(event)}</span>
                  <span className={`activity-result activity-result--${event.result}`}>
                    {resultLabel[event.result]}
                    {event.statusCode ? ` · ${event.statusCode}` : ""}
                  </span>
                </div>
                <div className="activity-event__actions">
                  {(event.targetType === "article" || event.targetType === "note") &&
                    event.targetId && (
                      <a href={href.activity(event.targetId, event.targetType)}>この記事の履歴</a>
                    )}
                  {event.targetId && event.targetType === "article" && (
                    <a href={href.article(event.targetId)}>記事を開く</a>
                  )}
                  {event.targetId && event.targetType === "note" && (
                    <a href={href.diaryNote(event.targetId)}>日記を開く</a>
                  )}
                  <button
                    type="button"
                    onClick={() => setExpanded(expanded === event.id ? null : event.id)}
                  >
                    {expanded === event.id ? "詳細を閉じる" : "詳細"}
                  </button>
                </div>
                {expanded === event.id && (
                  <dl className="activity-event__details">
                    <dt>リクエストID</dt>
                    <dd>
                      <code>{event.requestId}</code>
                    </dd>
                    <dt>クライアント識別子</dt>
                    <dd>
                      <code>{event.clientId ?? "unknown"}</code>{" "}
                      <span className="muted">（安全なハッシュ）</span>
                    </dd>
                    {event.clientRedirectHost && (
                      <>
                        <dt>OAuth戻り先</dt>
                        <dd>{event.clientRedirectHost}</dd>
                      </>
                    )}
                    {event.oauthGrantRef && (
                      <>
                        <dt>Grant参照</dt>
                        <dd>
                          <code>{event.oauthGrantRef}</code>
                        </dd>
                      </>
                    )}
                    {event.publicationId && (
                      <>
                        <dt>公開処理ID</dt>
                        <dd>
                          <code>{event.publicationId}</code>
                        </dd>
                      </>
                    )}
                    <dt>操作元</dt>
                    <dd>{event.source}</dd>
                    <dt>記録情報</dt>
                    <dd>
                      <code>{JSON.stringify(event.metadata)}</code>
                    </dd>
                  </dl>
                )}
              </article>
            ))}
          </div>
        )}
        {pages > 1 && (
          <nav className="activity-pagination" aria-label="履歴ページ">
            <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              前へ
            </button>
            <span>
              {page} / {pages}
            </span>
            <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              次へ
            </button>
          </nav>
        )}
      </Panel>
    </>
  );
}
