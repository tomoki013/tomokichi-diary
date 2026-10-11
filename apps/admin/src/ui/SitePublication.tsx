import type { PublicationStatus } from "../lib/api";
import type { Resource } from "./hooks";
import { ErrorState } from "./parts";

export function SitePublication({
  publication,
  disabled,
  onRetry,
}: {
  publication: Resource<PublicationStatus>;
  disabled: boolean;
  onRetry: () => void;
}) {
  const status = publication.data;
  return (
    <div className="publication-status" aria-live="polite">
      {publication.error ? (
        <ErrorState error={publication.error} onRetry={() => void publication.reload()} />
      ) : (
        status && (
          <>
            <p>
              {
                {
                  deployed: "サイトに反映済み",
                  queued: "サイトへの反映待ち",
                  building: "サイトを生成・反映中…",
                  failed: "サイトへの反映に失敗",
                  unconfigured: "自動反映の設定が必要です",
                }[status.state]
              }
            </p>
            {status.state === "unconfigured" && (
              <p className="form-error">
                DBには保存されています。公開連携用のGitHubトークンを設定するまでサイトには反映されません。
              </p>
            )}
            {status.error && <p className="form-error">{status.error}</p>}
            {status.buildUrl && (
              <a href={status.buildUrl} target="_blank" rel="noopener noreferrer">
                反映処理のログ ↗
              </a>
            )}
            {status.configured && status.state === "failed" && (
              <button type="button" disabled={disabled} onClick={onRetry}>
                サイトへの反映を再試行
              </button>
            )}
          </>
        )
      )}
    </div>
  );
}
