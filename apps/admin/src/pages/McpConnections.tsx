import { useState } from "react";
import { api, type McpConnectionDto } from "../lib/api";
import { useResource } from "../ui/hooks";
import { ErrorState, PageHeader, Panel } from "../ui/parts";
import { useToast } from "../ui/toast";

const issuerLabel: Record<McpConnectionDto["issuer"], string> = {
  analytics: "Analytics · 新ドメイン",
  "analytics-legacy": "Analytics · 旧接続",
  operator: "Operator · 新ドメイン",
  "operator-legacy": "Operator · 旧接続",
};

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) : "—";
}

const nameKey = (connection: McpConnectionDto) =>
  `${connection.clientId}|${connection.redirectHost ?? "unknown"}`;

export function McpConnections() {
  const toast = useToast();
  const [names, setNames] = useState<Record<string, string>>({});
  const connections = useResource(() => api.connections(), "mcp-connections");
  const items = connections.data?.items ?? [];

  const revoke = async (connection: McpConnectionDto) => {
    const label =
      connection.clientName === "unknown"
        ? connection.clientId.slice(0, 12)
        : connection.clientName;
    if (
      !globalThis.confirm(
        `「${label}」の${issuerLabel[connection.issuer]}接続を無効化しますか？発行済みトークンへの失効反映には時間がかかる場合があります。`,
      )
    )
      return;
    try {
      await api.revokeConnection(connection);
      await connections.reload();
    } catch (caught) {
      toast.error(caught);
    }
  };

  const confirmName = async (connection: McpConnectionDto) => {
    const key = nameKey(connection);
    const displayName = (names[key] ?? connection.clientName).trim();
    if (!displayName || displayName === "unknown" || !connection.redirectHost) return;
    if (
      !globalThis.confirm(
        `client_id ${connection.clientId} と戻り先 ${connection.redirectHost} に「${displayName}」という管理者確認済み表示名を設定しますか？`,
      )
    )
      return;
    try {
      await api.confirmMcpClientName(connection.clientId, connection.redirectHost, displayName);
      await connections.reload();
    } catch (caught) {
      toast.error(caught);
    }
  };

  return (
    <>
      <PageHeader
        title="MCP接続"
        meta={
          <span>
            OAuth
            Grantと権限を確認し、接続単位でトークンを失効できます。client_nameは自己申告として表示します。
          </span>
        }
      />
      <Panel title={`${items.length}件`}>
        {connections.error ? (
          <ErrorState error={connections.error} onRetry={() => void connections.reload()} />
        ) : connections.loading ? (
          <p className="state">読み込み中…</p>
        ) : items.length === 0 ? (
          <p className="state">登録済みの接続はありません。</p>
        ) : (
          <div className="connection-list">
            {items.map((connection) => (
              <article className="connection-card" key={`${connection.issuer}:${connection.id}`}>
                <header>
                  <div>
                    <strong>
                      {connection.clientName === "unknown"
                        ? "不明なクライアント"
                        : connection.clientName}
                    </strong>
                    <span className="connection-card__trust">
                      {connection.clientTrust === "confirmed"
                        ? "確認済み表示"
                        : connection.clientTrust === "self-asserted"
                          ? "自己申告名"
                          : "名称不明"}
                    </span>
                    <p className="muted">
                      {issuerLabel[connection.issuer]} · {connection.active ? "有効" : "期限切れ"}
                    </p>
                  </div>
                  {connection.active && (
                    <button
                      type="button"
                      className="danger"
                      onClick={() => void revoke(connection)}
                    >
                      接続を無効化
                    </button>
                  )}
                </header>
                <dl>
                  <dt>認証主体</dt>
                  <dd>
                    <code>{connection.actorSubject}</code>
                  </dd>
                  <dt>client_id（ハッシュ）</dt>
                  <dd>
                    <code>{connection.clientId}</code>
                  </dd>
                  <dt>確認済み表示名</dt>
                  <dd className="connection-card__name">
                    <input
                      aria-label={`${connection.clientId} の確認済み表示名`}
                      value={
                        names[nameKey(connection)] ??
                        (connection.clientTrust === "confirmed"
                          ? connection.clientName
                          : connection.clientName === "unknown"
                            ? ""
                            : connection.clientName)
                      }
                      placeholder="例: ChatGPT / Muse"
                      onChange={(event) =>
                        setNames({ ...names, [nameKey(connection)]: event.target.value })
                      }
                    />
                    <button
                      type="button"
                      disabled={!connection.redirectHost}
                      onClick={() => void confirmName(connection)}
                    >
                      表示名を確認
                    </button>
                  </dd>
                  <dt>認証リダイレクト先</dt>
                  <dd>{connection.redirectHost ?? "不明"}</dd>
                  <dt>権限</dt>
                  <dd>{connection.scopes.join(", ") || "なし"}</dd>
                  <dt>承認日時</dt>
                  <dd>{formatDate(connection.approvedAt)}</dd>
                  <dt>最終利用日時</dt>
                  <dd>{formatDate(connection.lastUsedAt)}</dd>
                  <dt>有効期限</dt>
                  <dd>{formatDate(connection.expiresAt)}</dd>
                </dl>
              </article>
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}
