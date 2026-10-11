import { useEffect, useState } from "react";
import type { ArticleDetailDto, PublishCheckDto } from "@tomokichi/contracts";
import { api } from "../../lib/api";
import { publishProblem } from "../../lib/publish-messages";
import { SitePublication } from "../../ui/SitePublication";
import { formatDateTime, isoToJstLocal, jstLocalToIso } from "../../lib/labels";
import { useResource, type Resource } from "../../ui/hooks";
import { ErrorState, Panel, SkeletonRows } from "../../ui/parts";
import { useToast } from "../../ui/toast";

/**
 * Everything that changes what readers see. Publishing takes the saved
 * revision, so unsaved edits are saved first rather than silently left out.
 */
export function PublishSection({
  article,
  check,
  dirty,
  save,
  onChanged,
  working,
  onBusy,
}: {
  article: ArticleDetailDto;
  check: Resource<PublishCheckDto>;
  dirty: boolean;
  save: () => Promise<boolean>;
  onChanged: () => Promise<void>;
  working: boolean;
  onBusy: (busy: boolean) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [when, setWhen] = useState("");
  const publication = useResource(() => api.publicationStatus(), "publication");
  const reloadPublication = publication.reload;
  useEffect(() => {
    const timer = setInterval(() => void reloadPublication(), 10000);
    return () => clearInterval(timer);
  }, [reloadPublication]);

  const run = async (
    action: () => Promise<unknown>,
    done: string,
    validate = false,
  ): Promise<void> => {
    setBusy(true);
    onBusy(true);
    try {
      if (dirty && !(await save())) return;
      const fresh = validate ? await api.publishCheck(article.id) : null;
      if (fresh && !fresh.publishable) {
        await check.reload();
        throw new Error(fresh.problems.map((p) => publishProblem(p.message)).join("\n"));
      }
      await action();
      toast.info(done);
      await onChanged();
      await publication.reload();
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  };

  const publishable = check.data?.publishable === true;
  // A live article with nothing new would republish the same revision.
  const nothingToPublish = article.isLive && !article.hasUnpublishedChanges && !dirty;
  const liveUrl =
    article.path && article.isLive ? `https://tomokichidiary.com${article.path}` : null;

  return (
    <Panel title="公開">
      {dirty && (
        <p className="muted">未保存の本文・写真・関連付けをすべて保存してから確認します。</p>
      )}
      {check.error ? (
        <ErrorState error={check.error} onRetry={() => void check.reload()} />
      ) : check.loading && !check.data ? (
        <SkeletonRows rows={2} />
      ) : check.data && !check.data.publishable && !dirty ? (
        <ul className="problems">
          {check.data.problems.map((problem) => (
            <li key={`${problem.code}-${problem.field ?? ""}`}>
              {problem.field ? <code>{problem.field}</code> : null}{" "}
              {publishProblem(problem.message)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="ok-line">
          {nothingToPublish
            ? "DBの公開版は最新です"
            : `公開できます${dirty ? "（保存してから公開します）" : ""}`}
        </p>
      )}

      <SitePublication
        publication={publication}
        disabled={busy || working}
        onRetry={() => void run(() => api.retryPublication(), "反映を再試行します")}
      />
      <div className="stack">
        <button
          type="button"
          className="primary"
          disabled={
            busy ||
            working ||
            article.status === "scheduled" ||
            (!publishable && !dirty) ||
            nothingToPublish
          }
          onClick={() =>
            void run(
              () => api.publish(article.id),
              article.isLive ? "変更の公開を受け付けました" : "公開を受け付けました",
              true,
            )
          }
        >
          {article.isLive ? "変更を公開" : "公開する"}
        </button>

        {!article.isLive &&
          (scheduling ? (
            <form
              className="inline-form"
              onSubmit={(event) => {
                event.preventDefault();
                const at = jstLocalToIso(when);
                if (!at) return;
                void run(
                  () => api.schedule(article.id, at),
                  `${formatDateTime(at)} に予約しました`,
                  true,
                );
                setScheduling(false);
              }}
            >
              <label className="field">
                <span>公開日時（日本時間）</span>
                <input
                  type="datetime-local"
                  required
                  min={isoToJstLocal(new Date().toISOString())}
                  value={when}
                  onChange={(event) => setWhen(event.target.value)}
                />
              </label>
              <div className="row">
                <button
                  type="submit"
                  disabled={busy || working || (!publishable && !dirty) || when === ""}
                >
                  予約する
                </button>
                <button type="button" className="link" onClick={() => setScheduling(false)}>
                  やめる
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              disabled={busy || working || (!publishable && !dirty)}
              onClick={() => {
                setWhen(isoToJstLocal(article.scheduledAt));
                setScheduling(true);
              }}
            >
              {article.status === "scheduled"
                ? `予約を変更（${formatDateTime(article.scheduledAt)}）`
                : "日時を予約して公開"}
            </button>
          ))}

        {liveUrl && (
          <a className="button" href={liveUrl} target="_blank" rel="noopener noreferrer">
            公開ページを開く ↗
          </a>
        )}

        {(article.status === "published" || article.status === "scheduled") && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const scheduled = article.status === "scheduled";
              const question = scheduled
                ? "予約を取り消して下書きに戻しますか？"
                : "非公開に戻しますか？ 公開ページは表示されなくなります。";
              if (globalThis.confirm(question)) {
                void run(
                  () => api.unpublish(article.id),
                  scheduled ? "予約を取り消しました" : "非公開に戻しました",
                );
              }
            }}
          >
            {article.status === "scheduled" ? "予約を取り消す" : "非公開に戻す"}
          </button>
        )}

        {article.status !== "archived" && (
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={() => {
              if (globalThis.confirm("アーカイブしますか？ 一覧の「アーカイブ」に移ります。")) {
                void run(() => api.archive(article.id), "アーカイブしました");
              }
            }}
          >
            アーカイブ
          </button>
        )}
      </div>
    </Panel>
  );
}
