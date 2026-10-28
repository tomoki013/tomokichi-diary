import { useEffect, useState } from "react";
import { publicationStages } from "@tomokichi/contracts";
import type { PublicationStatus } from "../lib/api";
import { formatDateTime } from "../lib/labels";
import type { Resource } from "./hooks";
import { ErrorState } from "./parts";

const labels = {
  data: "公開データ準備",
  images: "画像処理",
  site: "サイト生成",
  checks: "公開前チェック",
  deploy: "配信",
  verify: "反映確認",
};
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
  const pending = status?.state === "queued" || status?.state === "building";
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pending]);
  const elapsed =
    pending && status?.requestedAt
      ? Math.max(0, clock - Date.parse(status.requestedAt))
      : status?.durationMs;
  return (
    <div className="publication-status" aria-live="polite" aria-atomic="false">
      <p className="muted">サイト全体の反映状況（全記事で共通）</p>
      {publication.error ? (
        <ErrorState error={publication.error} onRetry={() => void publication.reload()} />
      ) : (
        status && (
          <>
            <p>
              <strong>
                {!status.requestId
                  ? "サイトの公開要求はありません"
                  : {
                      deployed: "サイトに反映済み",
                      queued: "反映の開始待ち（GitHub Actions）",
                      building: "サイトを更新しています",
                      failed: "サイトへの反映に失敗",
                      unconfigured: "自動反映の設定が必要です",
                    }[status.state]}
              </strong>
            </p>
            {status.state === "building" && (
              <p>現在：{status.stage ? `${labels[status.stage]}中` : "公開処理を実行中"}</p>
            )}
            {status.requestId && (
              <ol className="publication-stages" aria-label="サイト公開の工程">
                <li data-state={status.startedAt ? "completed" : "running"}>
                  開始待ち{status.startedAt ? " ✓" : ""}
                </li>
                {publicationStages.map((stage) => {
                  const result = status.stages[stage];
                  return (
                    <li
                      key={stage}
                      data-state={result?.state ?? "pending"}
                      aria-current={result?.state === "running" ? "step" : undefined}
                    >
                      {labels[stage]}
                      {result?.state === "completed"
                        ? " ✓"
                        : result?.state === "skipped"
                          ? "（省略）"
                          : result?.state === "failed"
                            ? "（失敗）"
                            : result?.state === "running"
                              ? "中"
                              : ""}
                    </li>
                  );
                })}
                <li data-state={status.state === "deployed" ? "completed" : "pending"}>
                  完了{status.state === "deployed" ? " ✓" : ""}
                </li>
              </ol>
            )}
            {elapsed != null && (
              <p aria-live="off">
                {pending ? "経過時間" : "所要時間"}：{Math.floor(elapsed / 1000)}
                秒（開始待ちを含む）
              </p>
            )}
            {status.state === "deployed" && status.deployedAt && (
              <>
                <p>反映日時：{formatDateTime(status.deployedAt)}</p>
                <a href="https://tomokichidiary.com" target="_blank" rel="noopener noreferrer">
                  公開サイトを開く ↗
                </a>
              </>
            )}
            {status.state === "unconfigured" && (
              <p className="form-error">
                DBには保存されています。公開連携用のGitHubトークンを設定するまでサイトには反映されません。
              </p>
            )}
            {status.error && (
              <p className="form-error">
                {status.error}
                {status.errorCode && <small>（{status.errorCode}）</small>}
              </p>
            )}
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
